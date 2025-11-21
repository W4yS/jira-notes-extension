// parser.js
// Модуль парсинга и сопоставления адресов / офисов
// Подключается ДО content.js (см. manifest.json)
// Не использует import/export ради совместимости с MV3 content scripts

(function(){
  'use strict';
  /**
   * Модуль парсинга Jira:
   *  - нормализация адресов (для устойчивых сравнений)
   *  - построение сопоставлений code <-> address из защищённого файла code.json
   *  - определение кода офиса по разным стратегиям (упоминание кода, паттерны, токены адреса, нормализованный адрес)
   *  - определение типа устройства.
   * Не использует import/export (ограничения MV3) – экспорт через window.JiraParser.
   */

  // Простая memoизация для нормализации адресов (локальный, не LRU)
  const normalizeCache = new Map();

  /**
   * Нормализует адрес: приводит к нижнему регистру и удаляет шумовые части.
   * @param {string} text
   * @returns {string}
   */
  function normalizeAddress(text){
    if(!text) return '';
    if(normalizeCache.has(text)) return normalizeCache.get(text);
    const result = text
      .toLowerCase()
      .replace(/санкт-петербург|спб|с-пб/gi, '')
      .replace(/бизнес-центр|бц/gi, '')
      .replace(/коворкинг/gi, '')
      .replace(/улица|ул\./gi, 'ул')
      .replace(/проспект|пр-кт|пр\./gi, 'пр')
      .replace(/дом|д\./gi, '')
      .replace(/корпус|к\./gi, 'к')
      .replace(/строение|стр\./gi, 'стр')
      .replace(/[.,\s"«»]+/g, '')
      .replace(/-/g, '');
    normalizeCache.set(text, result);
    return result;
  }

  /**
   * Генерирует морфологические варианты кода (фамилии) для поиска.
   * @param {string} code
   * @returns {string[]}
   */
  function buildPatternsForCode(code){
    const lc = code.toLowerCase();
    const patterns = new Set([lc]);
    if (/(ой|ый|ий)$/i.test(code)) patterns.add(lc.replace(/(ой|ый|ий)$/i,'ого'));
    if (/(ев|ёв|ов|ин)$/i.test(code)) patterns.add(lc+'а');
    if (/ский$/i.test(code)) patterns.add(lc.replace(/ский$/i,'ского'));
    if (/ая$/i.test(code)) patterns.add(lc.replace(/ая$/i,'ой'));
    if (/кий$/i.test(code)) patterns.add(lc.replace(/кий$/i,'кого'));
    return Array.from(patterns);
  }

  /**
   * Строит структуру сопоставления из данных code.json.
   * @param {{code:string[], addresses:string[]}} data
   * @returns {{codes:string[], addresses:string[], entries:Object[], mappingList:Object[]}}
   */
  function buildAddressMapping(data){
    const codes = Array.isArray(data.code)?data.code:[];
    const addresses = Array.isArray(data.addresses)?data.addresses:[];
    const rawEntries=[]; const maxLen=Math.max(codes.length, addresses.length);
    for(let i=0;i<maxLen;i++){
      const code=codes[i]; if(!code||typeof code!=="string") continue;
      const address=addresses[i]||'';
      // Разбиваем адрес на токены (улица, часть названия, номер дома) – используем только буквенные длинные куски
      const addressTokens = address
        .split(/[,/\s]+/)
        .map(t=>t.trim())
        .filter(t=>t.length>=4 && /[А-Яа-яЁё]/.test(t))
        .map(t=>t.toLowerCase());
      rawEntries.push({
        code: code.trim(),
        rawCode: code.trim(),
        addressRaw: address.trim(),
        normalizedAddress: normalizeAddress(address.trim()),
        patterns: buildPatternsForCode(code.trim()),
        addressTokens
      });
    }
    const seen=new Set(); const deduped=[];
    for(const e of rawEntries){
      const key=e.code+'|'+e.normalizedAddress;
      if(seen.has(key)) continue; seen.add(key); deduped.push(e);
    }
    return {
      codes: deduped.map(e=>e.code),
      addresses: deduped.map(e=>e.addressRaw),
      entries: deduped,
      mappingList: deduped
    };
  }

  /**
   * Определяет код офиса по исходной(ым) строке(ам) адреса.
   * @param {object} addressMapping
   * @param {string|string[]} rawAddress
   * @returns {string} код офиса или 'ХЗ'
   */
  function getOfficeCode(addressMapping, rawAddress){
    try {
      if(!rawAddress || !addressMapping?.mappingList?.length) return 'ХЗ';
      const joinedRaw = Array.isArray(rawAddress)? rawAddress.filter(Boolean).join(' | ') : rawAddress;
      const address = normalizeAddress(joinedRaw);

      // Stage 1: exact code mention
      for(const code of addressMapping.codes){
        if(joinedRaw.toLowerCase().includes(code.toLowerCase())){
          return code;
        }
      }

      // Stage 2: pattern scoring
      let best=null;
      for(const entry of addressMapping.mappingList){
        for(const pattern of entry.patterns){
          if(!pattern || pattern.length<4) continue;
          const idx=address.indexOf(pattern);
          if(idx!==-1){
            const beforeOk=idx===0 || /[^а-яё]/i.test(address[idx-1]);
            const afterOk=idx+pattern.length===address.length || /[^а-яё]/i.test(address[idx+pattern.length]);
            if(beforeOk && afterOk){
              const score=pattern.length;
              if(!best || score>best.score){ best={code:entry.code, score, pattern}; }
            }
          }
        }
      }
      if(best) return best.code;

      // Stage 2b: поиск по токенам адреса (street tokens) – повышает точность, если код не упомянут
      // Оцениваем совпадения токенов против нормализованной строки исходного адреса (joinedRaw без сложной морфологии)
      const loweredRaw = joinedRaw.toLowerCase();
      let tokenBest=null;
      for(const entry of addressMapping.entries){
        if(!entry.addressTokens || entry.addressTokens.length===0) continue;
        let tokenMatches=0;
        for(const token of entry.addressTokens){
          if(token.length<4) continue;
          // Ищем границы слова
          const regex = new RegExp(`(^|[^а-яё])${token}([^а-яё]|$)`, 'i');
          if(regex.test(loweredRaw)) tokenMatches++;
        }
        if(tokenMatches>0){
          const score = tokenMatches * 10 + entry.addressTokens[0].length; // простая метрика
          if(!tokenBest || score>tokenBest.score){ tokenBest={code:entry.code, score}; }
        }
      }
      if(tokenBest) return tokenBest.code;

      // Stage 3: normalized address matching
      if(addressMapping.entries?.length){
        for(const entry of addressMapping.entries){
          const normalizedAddr=entry.normalizedAddress;
          if(!normalizedAddr || normalizedAddr.length<6) continue;
          if(address.includes(normalizedAddr)) return entry.code;
        }
      }
      return 'ХЗ';
    } catch(e){
      return 'ХЗ';
    }
  }

  // Device type detection (перенесено из content.js для переиспользования)
  /**
   * Определяет тип устройства по полям заявки.
   * @param {Object} fields
   * @returns {'apple'|'windows'|'other'}
   */
  function detectDeviceType(fields){
    const equipmentField = fields.customfield_11122;
    if(!equipmentField || !equipmentField.value) return 'other';
    const value = equipmentField.value.toLowerCase();
    if(value.includes('macbook') || value.includes('mac') || value.includes('apple')) return 'apple';
    if(value.includes('windows') || value.includes('ноутбук') || value.includes('laptop')) return 'windows';
    return 'other';
  }

  window.JiraParser = {
    normalizeAddress,
    buildAddressMapping,
    getOfficeCode,
    detectDeviceType
  };
})();

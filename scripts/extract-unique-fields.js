#!/usr/bin/env node
/**
 * Collect unique field keys, labels and values from Jira issues export JSON.
 * Input: jira-issues-export-YYYY-MM-DD.json (array of { extractedAt, fields, issueKey })
 * Output: unique-fields-summary.json with structure:
 * {
 *   fieldKey: {
 *     labels: [ ...unique labels ],
 *     valueCount: number,
 *     samples: [ up to 50 values ],
 *     allValuesTruncated: boolean,
 *     types: ["string","number","object",...],
 *     emptyCount: number,
 *     nullCount: number
 *   },
 *   ...
 * }
 */

const fs = require('fs');
const path = require('path');

function detectType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v; // string, number, boolean, object
}

function normalizeValue(v) {
  if (v === null) return null;
  if (typeof v === 'string') return v.trim();
  return v;
}

function main() {
  const exportFile = process.argv[2] || 'jira-issues-export-2025-11-19.json';
  const inputPath = path.resolve(process.cwd(), exportFile);
  if (!fs.existsSync(inputPath)) {
    console.error('❌ File not found:', inputPath);
    process.exit(1);
  }
  const raw = fs.readFileSync(inputPath, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error('❌ JSON parse error:', e.message);
    process.exit(1);
  }
  if (!Array.isArray(data)) {
    console.error('❌ Expected top-level array');
    process.exit(1);
  }

  const fieldMap = new Map(); // key -> { labels:Set, values:Set, types:Set, emptyCount, nullCount }

  for (const issue of data) {
    const fields = issue.fields || {};
    for (const key of Object.keys(fields)) {
      const entry = fields[key];
      const label = entry && typeof entry === 'object' ? entry.label : undefined;
      const value = entry && typeof entry === 'object' ? entry.value : entry;
      const normValue = normalizeValue(value);
      let bucket = fieldMap.get(key);
      if (!bucket) {
        bucket = { labels: new Set(), values: new Set(), types: new Set(), emptyCount: 0, nullCount: 0 };
        fieldMap.set(key, bucket);
      }
      if (label) bucket.labels.add(label);
      if (normValue === null) {
        bucket.nullCount += 1;
      } else if (normValue === '' || normValue === '-' ) {
        bucket.emptyCount += 1;
      } else {
        // Represent complex values as JSON string for uniqueness
        const type = detectType(normValue);
        bucket.types.add(type);
        if (type === 'object' || type === 'array') {
          try {
            bucket.values.add(JSON.stringify(normValue));
          } catch {
            bucket.values.add(String(normValue));
          }
        } else {
          bucket.values.add(String(normValue));
        }
      }
    }
  }

  const summary = {};
  for (const [key, bucket] of fieldMap.entries()) {
    const valuesArray = Array.from(bucket.values);
    summary[key] = {
      labels: Array.from(bucket.labels),
      valueCount: valuesArray.length,
      samples: valuesArray.slice(0, 50),
      allValuesTruncated: valuesArray.length > 50,
      types: Array.from(bucket.types),
      emptyCount: bucket.emptyCount,
      nullCount: bucket.nullCount
    };
  }

  const outPath = path.resolve(process.cwd(), 'unique-fields-summary.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');

  // Also print a concise overview to console
  console.log('🧪 Unique field summary generated');
  console.log('Total distinct field keys:', Object.keys(summary).length);
  for (const key of Object.keys(summary)) {
    const info = summary[key];
    console.log(`• ${key} | labels:${info.labels.length} values:${info.valueCount} types:${info.types.join(',')}`);
  }
  console.log('📄 Full details saved to unique-fields-summary.json');
}

if (require.main === module) {
  main();
}

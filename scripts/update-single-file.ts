/**
 * Update single file in Supabase vector database
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing env vars');
  process.exit(1);
}

const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const KNOWLEDGE_BASE_PATH = path.resolve(__dirname, '../../Peter Daniels');
const RELATIVE_FILE = '02_Seminars_and_Courses/2005 - Ukraine Business Seminar/Lesson 02 - Factors of Success.md';
const FULL_PATH = path.join(KNOWLEDGE_BASE_PATH, RELATIVE_FILE);

const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;
const BATCH_SIZE = 5;
const DELAY_MS = 1000;

function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end).trim());
    start += size - overlap;
  }
  return chunks.filter((c) => c.length > 100);
}

async function getEmbedding(text: string): Promise<number[]> {
  const result = await genai.models.embedContent({
    model: 'gemini-embedding-001',
    contents: text,
    config: { outputDimensionality: 768 },
  });
  return result.embeddings![0].values!;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`🔄 Updating single file: ${RELATIVE_FILE}`);

  if (!fs.existsSync(FULL_PATH)) {
    console.error(`File not found: ${FULL_PATH}`);
    process.exit(1);
  }

  // 1. Delete existing chunks for this specific file
  console.log('🗑️ Removing old chunks from Supabase...');
  const { error: delError } = await supabase
    .from('documents')
    .delete()
    .eq('source', RELATIVE_FILE);

  if (delError) {
    console.error('Failed to delete old chunks:', delError.message);
    process.exit(1);
  }

  // 2. Read new content and chunk
  const content = fs.readFileSync(FULL_PATH, 'utf-8');
  const chunks = chunkText(content);
  console.log(`📄 New chunks to index: ${chunks.length}`);

  let totalChunks = 0;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);

    const rows = await Promise.all(
      batch.map(async (chunk, j) => {
        const embedding = await getEmbedding(chunk);
        return {
          content: chunk,
          source: RELATIVE_FILE,
          chunk_index: i + j,
          embedding,
        };
      })
    );

    const { error: insertError } = await supabase.from('documents').insert(rows);

    if (insertError) {
      console.error(`❌ Error inserting: ${insertError.message}`);
    } else {
      totalChunks += batch.length;
      process.stdout.write(`  ✅ ${totalChunks}/${chunks.length} chunks uploaded\r`);
    }

    if (i + BATCH_SIZE < chunks.length) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n🎉 File successfully updated! Total chunks: ${totalChunks}`);
}

main().catch(console.error);

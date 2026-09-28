/**
 * Knowledge Base Indexing Script
 * Reads all .md files from Peter Daniels folder, creates embeddings via Gemini,
 * and stores them in Supabase with pgvector for RAG retrieval.
 *
 * Run: npm run index
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

// Load env
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing env vars. Check .env.local');
  process.exit(1);
}

const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const KNOWLEDGE_BASE_PATH = path.resolve(
  __dirname,
  '../../Peter Daniels'
);

const CHUNK_SIZE = 1500; // characters per chunk
const CHUNK_OVERLAP = 200;
const BATCH_SIZE = 5; // embeddings per batch (rate limit friendly)
const DELAY_MS = 1000; // delay between batches

function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end).trim());
    start += size - overlap;
  }
  return chunks.filter((c) => c.length > 100); // skip tiny chunks
}

function getAllMdFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllMdFiles(fullPath));
    } else if (entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
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
  console.log('🚀 Starting knowledge base indexing...\n');
  console.log(`📁 Source: ${KNOWLEDGE_BASE_PATH}`);

  // Get all markdown files
  const mdFiles = getAllMdFiles(KNOWLEDGE_BASE_PATH);
  console.log(`📄 Found ${mdFiles.length} markdown files\n`);

  // Check if table exists (if not, skip and warn)
  const { error: tableError } = await supabase
    .from('documents')
    .select('id')
    .limit(1);

  if (tableError) {
    console.error('❌ Cannot access "documents" table in Supabase.');
    console.error('   Please run the SQL migration first (see README).');
    console.error('   Error:', tableError.message);
    process.exit(1);
  }

  let totalChunks = 0;
  let processedFiles = 0;

  for (const filePath of mdFiles) {
    const relativePath = path.relative(KNOWLEDGE_BASE_PATH, filePath);
    const content = fs.readFileSync(filePath, 'utf-8');

    if (content.trim().length < 100) {
      console.log(`⏭️  Skipping (too short): ${relativePath}`);
      continue;
    }

    const chunks = chunkText(content);
    console.log(`📖 ${relativePath} → ${chunks.length} chunks`);

    // Process in batches
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);

      const rows = await Promise.all(
        batch.map(async (chunk, j) => {
          const embedding = await getEmbedding(chunk);
          return {
            content: chunk,
            source: relativePath,
            chunk_index: i + j,
            embedding,
          };
        })
      );

      const { error } = await supabase.from('documents').upsert(rows, {
        onConflict: 'source,chunk_index',
      });

      if (error) {
        console.error(`  ❌ Error inserting chunks: ${error.message}`);
      } else {
        totalChunks += batch.length;
        process.stdout.write(`  ✅ ${Math.min(i + BATCH_SIZE, chunks.length)}/${chunks.length} chunks\r`);
      }

      if (i + BATCH_SIZE < chunks.length) {
        await sleep(DELAY_MS);
      }
    }

    processedFiles++;
    console.log(`  ✅ Done (${processedFiles}/${mdFiles.length} files)\n`);
  }

  console.log('\n🎉 Indexing complete!');
  console.log(`   Files processed: ${processedFiles}`);
  console.log(`   Total chunks: ${totalChunks}`);
}

main().catch(console.error);

-- Run this in Supabase SQL Editor (supabase.com → your project → SQL Editor)

-- 1. Enable pgvector extension
create extension if not exists vector;

-- 2. Drop and recreate documents table (vector(768) — gemini-embedding-001 with outputDimensionality: 768)
drop table if exists documents cascade;

create table documents (
  id bigserial primary key,
  content text not null,
  source text not null,
  chunk_index integer not null default 0,
  embedding vector(768),
  created_at timestamptz default now(),
  unique(source, chunk_index)
);

-- 3. Create vector similarity search index (IVFFlat, max 2000 dims — OK for 768)
create index documents_embedding_idx
  on documents
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- 4. Create the match_documents function for RAG retrieval
create or replace function match_documents(
  query_embedding vector(768),
  match_threshold float default 0.7,
  match_count int default 5
)
returns table (
  id bigint,
  content text,
  source text,
  similarity float
)
language sql stable
as $$
  select
    documents.id,
    documents.content,
    documents.source,
    1 - (documents.embedding <=> query_embedding) as similarity
  from documents
  where 1 - (documents.embedding <=> query_embedding) > match_threshold
  order by documents.embedding <=> query_embedding
  limit match_count;
$$;

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PETER_SYSTEM_PROMPT = `You are Peter Daniels — one of the world's greatest Christian businessman, author, and success coach. You were born in poverty in Adelaide, Australia, and overcame illiteracy to become a multimillionaire who advised presidents, kings, and world leaders.

YOUR PERSONALITY & SPEAKING STYLE:
- Speak with warmth, authority, and directness — the voice of a wise grandfather and seasoned mentor who has seen everything
- Use powerful rhetorical questions that challenge the listener to think bigger
- Share wisdom through personal stories, real biblical examples, and vivid analogies
- Blend faith (Christian principles) with practical business advice seamlessly
- Never preach — inspire through personal experience, tough love, and genuine care
- Use occasional pauses for emphasis (represented by em dashes — like this)
- End responses with a call to action, an empowering reflection, or a memorable statement
- You speak in the first person as Peter Daniels himself

YOUR CORE THEMES:
- Overcoming failure and mediocrity
- The power of dreams, written goals, and massive commitment
- Christian faith as a foundation for business success
- Leadership, character, and unflinching integrity
- Wealth as a tool for God's purposes, not an end in itself
- Taking massive, decisive action

ABOUT YOUR STUDENT (USER CONTEXT):
{user_profile}

ACTIVE STUDENT COMMITMENTS & TASKS (FROM PREVIOUS SESSIONS):
{user_commitments}

STUDENT'S PERSONAL NOTES & DOCUMENTS:
{user_notes}

ACCOUNTABILITY & ACTION-ORIENTED MENTORING RULES:
- If this is the start of a conversation and the student has ACTIVE COMMITMENTS from previous sessions, warmly but firmly ask about their progress on those commitments before diving into new theoretical discussions. Remember: "Faith without works is dead", and success requires execution!
- If the user asks to summarize the session or create an action plan (or clicks "Summarize Session"), deliver a razor-sharp executive summary:
  1. The Core Insight / Breakthrough
  2. 2-3 Immediate Concrete Actions (Commitments) with clarity and urgency
  3. A short, inspiring word of blessing and accountability.

LANGUAGE RULE:
- Always respond in the same language the user writes in (Russian or English)
- If in Russian: use natural, powerful Russian keeping the same warmth and authority
- Address the student personally by name if provided in their profile
- Tailor your advice directly to their specific business, life situation, and stated goals!

CONTEXT FROM PETER'S TEACHINGS:
{context}

Remember: You ARE Peter Daniels mentoring this specific student. Draw from your teachings and address their real situation with authentic wisdom.`;

async function getEmbedding(text: string): Promise<number[]> {
  const result = await genai.models.embedContent({
    model: 'gemini-embedding-001',
    contents: text,
    config: { outputDimensionality: 768 },
  });
  return result.embeddings![0].values!;
}

async function retrieveContext(query: string): Promise<string> {
  try {
    const embedding = await getEmbedding(query);

    const { data, error } = await supabase.rpc('match_documents', {
      query_embedding: embedding,
      match_threshold: 0.7,
      match_count: 5,
    });

    if (error || !data || data.length === 0) {
      return 'No specific context found — draw from your full life experience and teachings.';
    }

    return data
      .map((d: { content: string; source: string }) => `[From: ${d.source}]\n${d.content}`)
      .join('\n\n---\n\n');
  } catch {
    return 'No specific context found — draw from your full life experience and teachings.';
  }
}

export async function POST(req: NextRequest) {
  try {
    const { messages, lang, userProfile, userNotes, userCommitments } = await req.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
    }

    // Get the last user message for context retrieval
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    const query = lastUserMessage?.content || '';

    // Retrieve relevant context from knowledge base
    const context = await retrieveContext(query);

    // Format user profile
    let profileText = 'No specific profile provided.';
    if (userProfile && typeof userProfile === 'object') {
      const parts: string[] = [];
      if (userProfile.name) parts.push(`Name: ${userProfile.name}`);
      if (userProfile.occupation) parts.push(`Occupation / Business: ${userProfile.occupation}`);
      if (userProfile.goals) parts.push(`Life & Business Goals: ${userProfile.goals}`);
      if (userProfile.challenges) parts.push(`Current Challenges / Focus: ${userProfile.challenges}`);
      if (parts.length > 0) profileText = parts.join('\n');
    }

    // Format personal notes
    let notesText = 'No personal notes attached.';
    if (userNotes && Array.isArray(userNotes) && userNotes.length > 0) {
      notesText = userNotes
        .map((n: { title: string; content: string }) => `--- [Document: ${n.title}] ---\n${n.content}`)
        .join('\n\n');
    }

    // Format commitments
    let commitmentsText = 'No pending commitments.';
    if (userCommitments && Array.isArray(userCommitments) && userCommitments.length > 0) {
      const active = userCommitments.filter((c: { done?: boolean }) => !c.done);
      if (active.length > 0) {
        commitmentsText = active
          .map((c: { text: string; date?: string }, idx: number) => `${idx + 1}. ${c.text}${c.date ? ` (Запланировано: ${c.date})` : ''}`)
          .join('\n');
      }
    }

    // Build system prompt with all context
    const systemPrompt = PETER_SYSTEM_PROMPT
      .replace('{user_profile}', profileText)
      .replace('{user_commitments}', commitmentsText)
      .replace('{user_notes}', notesText)
      .replace('{context}', context);

    // Build conversation history for Gemini
    const history = messages.slice(0, -1).map((m: { role: string; content: string }) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const chat = genai.chats.create({
      model: 'gemini-3.8-flash',
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.85,
        maxOutputTokens: 2048,
      },
      history,
    });

    const response = await chat.sendMessage({ message: query });
    const reply = response.text ?? '';

    return NextResponse.json({ reply, lang });
  } catch (err) {
    console.error('Chat API error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

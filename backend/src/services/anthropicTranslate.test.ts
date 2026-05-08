import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  anthropicToOllamaRequest,
  ollamaToAnthropicResponse,
  ollamaStreamToAnthropicSSE,
  type OllamaStreamChunk,
} from './anthropicTranslate';
import type {
  AnthropicMessagesRequest,
  OllamaChatResponse,
} from '../types/anthropic';

function baseReq(overrides: Partial<AnthropicMessagesRequest> = {}): AnthropicMessagesRequest {
  return {
    model: 'qwen3.6',
    max_tokens: 256,
    messages: [{ role: 'user', content: 'hi' }],
    ...overrides,
  };
}

describe('anthropicToOllamaRequest', () => {
  it('translates a plain user message', () => {
    const out = anthropicToOllamaRequest(baseReq());
    assert.equal(out.model, 'qwen3.6');
    assert.deepEqual(out.messages, [{ role: 'user', content: 'hi' }]);
    assert.equal(out.options?.num_predict, 256);
    assert.equal(out.stream, false);
  });

  it('emits a system message from a string system param', () => {
    const out = anthropicToOllamaRequest(
      baseReq({ system: 'be terse' })
    );
    assert.deepEqual(out.messages[0], { role: 'system', content: 'be terse' });
  });

  it('concatenates system content blocks into one system message', () => {
    const out = anthropicToOllamaRequest(
      baseReq({
        system: [
          { type: 'text', text: 'rule one' },
          { type: 'text', text: 'rule two' },
        ],
      })
    );
    assert.deepEqual(out.messages[0], { role: 'system', content: 'rule one\n\nrule two' });
  });

  it('translates assistant tool_use + user tool_result into ollama tool messages', () => {
    const out = anthropicToOllamaRequest(
      baseReq({
        messages: [
          { role: 'user', content: 'do a thing' },
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'thinking...' },
              { type: 'tool_use', id: 'toolu_1', name: 'do_thing', input: { x: 1 } },
            ],
          },
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'toolu_1', content: 'result text' },
              { type: 'text', text: 'follow-up' },
            ],
          },
        ],
      })
    );
    assert.equal(out.messages[0].role, 'user');
    assert.equal(out.messages[1].role, 'assistant');
    assert.equal(out.messages[1].content, 'thinking...');
    assert.equal(out.messages[1].tool_calls?.[0]?.function.name, 'do_thing');
    assert.equal(out.messages[1].tool_calls?.[0]?.function.arguments, '{"x":1}');
    assert.equal(out.messages[2].role, 'tool');
    assert.equal(out.messages[2].tool_call_id, 'toolu_1');
    assert.equal(out.messages[2].content, 'result text');
    assert.equal(out.messages[3].role, 'user');
    assert.equal(out.messages[3].content, 'follow-up');
  });

  it('concatenates tool_result content blocks', () => {
    const out = anthropicToOllamaRequest(
      baseReq({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_1',
                content: [
                  { type: 'text', text: 'line a' },
                  { type: 'text', text: 'line b' },
                ],
              },
            ],
          },
        ],
      })
    );
    assert.equal(out.messages[0].role, 'tool');
    assert.equal(out.messages[0].content, 'line a\n\nline b');
  });

  it('prefixes is_error tool_result content with [error]', () => {
    const out = anthropicToOllamaRequest(
      baseReq({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'toolu_1', content: 'boom', is_error: true },
            ],
          },
        ],
      })
    );
    assert.equal(out.messages[0].content, '[error] boom');
  });

  it('translates tools to OpenAI-style function format', () => {
    const out = anthropicToOllamaRequest(
      baseReq({
        tools: [
          {
            name: 'add',
            description: 'add two numbers',
            input_schema: { type: 'object', properties: { a: { type: 'number' } } },
          },
        ],
      })
    );
    assert.equal(out.tools?.[0]?.type, 'function');
    assert.equal(out.tools?.[0]?.function.name, 'add');
    assert.deepEqual(out.tools?.[0]?.function.parameters, {
      type: 'object',
      properties: { a: { type: 'number' } },
    });
  });

  it('omits tools when tool_choice is none', () => {
    const out = anthropicToOllamaRequest(
      baseReq({
        tools: [{ name: 'add' }],
        tool_choice: 'none',
      })
    );
    assert.equal(out.tools, undefined);
  });

  it('passes server options through, with client values winning', () => {
    const out = anthropicToOllamaRequest(
      baseReq({ temperature: 0.2 }),
      { temperature: 0.9, num_ctx: 8192 }
    );
    assert.equal(out.options?.temperature, 0.2);
    assert.equal(out.options?.num_ctx, 8192);
  });
});

describe('ollamaToAnthropicResponse', () => {
  function ollamaResp(overrides: Partial<OllamaChatResponse> = {}): OllamaChatResponse {
    return {
      model: 'qwen3.6',
      message: { role: 'assistant', content: 'hello' },
      done: true,
      ...overrides,
    };
  }

  it('returns one text block with end_turn', () => {
    const r = ollamaToAnthropicResponse(ollamaResp(), 'qwen3.6');
    assert.equal(r.content.length, 1);
    assert.deepEqual(r.content[0], { type: 'text', text: 'hello' });
    assert.equal(r.stop_reason, 'end_turn');
  });

  it('maps done_reason: length to max_tokens', () => {
    const r = ollamaToAnthropicResponse(ollamaResp({ done_reason: 'length' }), 'qwen3.6');
    assert.equal(r.stop_reason, 'max_tokens');
  });

  it('emits tool_use blocks and stop_reason tool_use', () => {
    const r = ollamaToAnthropicResponse(
      ollamaResp({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'tc1', type: 'function', function: { name: 'add', arguments: '{"a":1}' } },
          ],
        },
      }),
      'qwen3.6'
    );
    assert.equal(r.stop_reason, 'tool_use');
    const block = r.content[0];
    assert.equal(block.type, 'tool_use');
    if (block.type === 'tool_use') {
      assert.equal(block.name, 'add');
      assert.deepEqual(block.input, { a: 1 });
    }
  });

  it('parses tool arguments whether stringified or already-parsed', () => {
    const r1 = ollamaToAnthropicResponse(
      ollamaResp({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'a', arguments: '{"k":1}' } }],
        },
      }),
      'm'
    );
    const r2 = ollamaToAnthropicResponse(
      ollamaResp({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'a', arguments: { k: 1 } } }],
        },
      }),
      'm'
    );
    if (r1.content[0].type === 'tool_use') assert.deepEqual(r1.content[0].input, { k: 1 });
    if (r2.content[0].type === 'tool_use') assert.deepEqual(r2.content[0].input, { k: 1 });
  });

  it('detects stop_sequence by suffix match', () => {
    const r = ollamaToAnthropicResponse(
      ollamaResp({ message: { role: 'assistant', content: 'output END' } }),
      'm',
      ['END']
    );
    assert.equal(r.stop_reason, 'stop_sequence');
    assert.equal(r.stop_sequence, 'END');
  });

  it('propagates token usage', () => {
    const r = ollamaToAnthropicResponse(
      ollamaResp({ prompt_eval_count: 12, eval_count: 34 }),
      'm'
    );
    assert.equal(r.usage.input_tokens, 12);
    assert.equal(r.usage.output_tokens, 34);
  });
});

describe('ollamaStreamToAnthropicSSE', () => {
  async function collect(chunks: OllamaStreamChunk[]): Promise<{ events: string[]; raw: string }> {
    const events: string[] = [];
    let raw = '';
    const it = ollamaStreamToAnthropicSSE(
      (async function* () {
        for (const c of chunks) yield c;
      })(),
      { requestModel: 'qwen3.6' }
    );
    for await (const e of it) {
      events.push(e);
      raw += e;
    }
    return { events, raw };
  }

  function eventName(e: string): string {
    return e.split('\n')[0].replace('event: ', '');
  }

  it('emits a clean text-only stream', async () => {
    const { events } = await collect([
      { message: { content: 'hel' } },
      { message: { content: 'lo' } },
      { done: true, eval_count: 2, prompt_eval_count: 5 },
    ]);
    const names = events.map(eventName);
    assert.deepEqual(names, [
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
    const msgDelta = events.find((e) => eventName(e) === 'message_delta')!;
    assert.match(msgDelta, /"output_tokens":2/);
    assert.match(msgDelta, /"input_tokens":5/);
  });

  it('emits text then tool_use with correct indices', async () => {
    const { events, raw } = await collect([
      { message: { content: 'thinking' } },
      {
        message: {
          content: '',
          tool_calls: [
            { id: 'tc1', function: { name: 'add', arguments: '{"a":1}' } },
          ],
        },
      },
      { done: true, eval_count: 1 },
    ]);
    const names = events.map(eventName);
    assert.deepEqual(names, [
      'message_start',
      'content_block_start',     // text
      'content_block_delta',     // text_delta
      'content_block_stop',      // text closed before tool starts
      'content_block_start',     // tool_use
      'content_block_delta',     // input_json_delta
      'content_block_stop',      // tool_use closed
      'message_delta',
      'message_stop',
    ]);
    assert.match(raw, /"index":0/);
    assert.match(raw, /"index":1/);
    assert.match(raw, /"stop_reason":"tool_use"/);
  });
});

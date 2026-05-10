import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  anthropicToOllamaRequest,
  ollamaToAnthropicResponse,
  ollamaStreamToAnthropicSSE,
  extractEmbeddedToolCalls,
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
    assert.deepEqual(out.messages[1].tool_calls?.[0]?.function.arguments, { x: 1 });
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

  it('forwards tool_use input as object, not stringified JSON', () => {
    // Regression: stringifying produced multi-escaped strings that Ollama's
    // tool-call parser rejected with "Value looks like object, but can't
    // find closing '}' symbol".
    const out = anthropicToOllamaRequest(
      baseReq({
        messages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_1',
                name: 'run_code',
                input: {
                  code: 'import os\nprint("/Users/defied")',
                  flags: ['-x', '-y'],
                },
              },
            ],
          },
        ],
      })
    );
    const args = out.messages[0].tool_calls?.[0]?.function.arguments;
    assert.equal(typeof args, 'object');
    assert.deepEqual(args, {
      code: 'import os\nprint("/Users/defied")',
      flags: ['-x', '-y'],
    });
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

  it('salvages tool calls when the model emits markup as text', () => {
    const r = ollamaToAnthropicResponse(
      {
        model: 'qwen3-coder:30b',
        message: {
          role: 'assistant',
          content:
            "I'll list /tmp.\n<function=Bash>\n<parameter=command>\nls /tmp\n</parameter>\n<parameter=timeout>\n5000\n</parameter>\n</function>\n</tool_call>",
        },
        done: true,
      },
      'qwen3-coder:30b',
      undefined,
      ['Bash', 'Read']
    );
    assert.equal(r.stop_reason, 'tool_use');
    assert.equal(r.content.length, 2);
    assert.equal(r.content[0].type, 'text');
    if (r.content[0].type === 'text') {
      assert.equal(r.content[0].text, "I'll list /tmp.");
    }
    const tu = r.content[1];
    assert.equal(tu.type, 'tool_use');
    if (tu.type === 'tool_use') {
      assert.equal(tu.name, 'Bash');
      assert.deepEqual(tu.input, { command: 'ls /tmp', timeout: 5000 });
    }
  });

  it('salvages <tool_call> JSON-style markup', () => {
    const r = ollamaToAnthropicResponse(
      {
        model: 'm',
        message: {
          role: 'assistant',
          content:
            'reply\n<tool_call>\n{"name":"Read","arguments":{"file_path":"/etc/hosts"}}\n</tool_call>',
        },
        done: true,
      },
      'm',
      undefined,
      ['Read', 'Bash']
    );
    assert.equal(r.stop_reason, 'tool_use');
    const tu = r.content.find((b) => b.type === 'tool_use');
    assert.ok(tu);
    if (tu && tu.type === 'tool_use') {
      assert.equal(tu.name, 'Read');
      assert.deepEqual(tu.input, { file_path: '/etc/hosts' });
    }
  });

  it('does not salvage when knownTools is empty (no false positives)', () => {
    const r = ollamaToAnthropicResponse(
      {
        model: 'm',
        message: {
          role: 'assistant',
          content: '<function=Bash><parameter=command>ls</parameter></function>',
        },
        done: true,
      },
      'm'
    );
    assert.equal(r.stop_reason, 'end_turn');
    assert.equal(r.content.length, 1);
    assert.equal(r.content[0].type, 'text');
  });

  it('does not salvage if Ollama already returned structured tool_calls', () => {
    const r = ollamaToAnthropicResponse(
      {
        model: 'm',
        message: {
          role: 'assistant',
          content:
            '<function=Bash><parameter=command>ls</parameter></function>',
          tool_calls: [
            { function: { name: 'Read', arguments: { file_path: '/x' } } },
          ],
        },
        done: true,
      },
      'm',
      undefined,
      ['Bash', 'Read']
    );
    // Trust the structured one; do not also extract the text markup.
    const toolUseBlocks = r.content.filter((b) => b.type === 'tool_use');
    assert.equal(toolUseBlocks.length, 1);
    if (toolUseBlocks[0].type === 'tool_use') {
      assert.equal(toolUseBlocks[0].name, 'Read');
    }
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

describe('extractEmbeddedToolCalls', () => {
  it('parses llama-style function/parameter markup', () => {
    const r = extractEmbeddedToolCalls(
      "say hi\n<function=Bash>\n<parameter=command>\necho 'hi'\n</parameter>\n</function>",
      ['Bash']
    );
    assert.equal(r.toolCalls.length, 1);
    assert.equal(r.toolCalls[0].name, 'Bash');
    assert.deepEqual(r.toolCalls[0].input, { command: "echo 'hi'" });
    assert.equal(r.cleanedText, 'say hi');
  });

  it('coerces numeric and boolean parameter values', () => {
    const r = extractEmbeddedToolCalls(
      '<function=Run><parameter=count>3</parameter><parameter=force>true</parameter><parameter=name>alpha</parameter></function>',
      ['Run']
    );
    assert.deepEqual(r.toolCalls[0].input, {
      count: 3,
      force: true,
      name: 'alpha',
    });
  });

  it('preserves multi-line parameter content', () => {
    const r = extractEmbeddedToolCalls(
      '<function=Write><parameter=content>line1\nline2\n  line3</parameter></function>',
      ['Write']
    );
    assert.equal(r.toolCalls[0].input.content, 'line1\nline2\n  line3');
  });

  it('ignores function calls referencing unknown tools', () => {
    const r = extractEmbeddedToolCalls(
      '<function=Unknown><parameter=x>1</parameter></function>',
      ['Bash']
    );
    assert.equal(r.toolCalls.length, 0);
    // Untouched markup remains in cleaned text.
    assert.match(r.cleanedText, /Unknown/);
  });

  it('parses multiple consecutive function calls', () => {
    const r = extractEmbeddedToolCalls(
      '<function=Bash><parameter=command>ls</parameter></function><function=Bash><parameter=command>pwd</parameter></function>',
      ['Bash']
    );
    assert.equal(r.toolCalls.length, 2);
    assert.equal(r.toolCalls[0].input.command, 'ls');
    assert.equal(r.toolCalls[1].input.command, 'pwd');
  });

  it('parses qwen JSON-style <tool_call>', () => {
    const r = extractEmbeddedToolCalls(
      'pre\n<tool_call>{"name":"Bash","arguments":{"command":"ls"}}</tool_call>\npost',
      ['Bash']
    );
    assert.equal(r.toolCalls.length, 1);
    assert.deepEqual(r.toolCalls[0].input, { command: 'ls' });
    assert.match(r.cleanedText, /pre/);
    assert.match(r.cleanedText, /post/);
  });

  it('returns empty when knownTools is empty', () => {
    const r = extractEmbeddedToolCalls(
      '<function=Bash><parameter=command>ls</parameter></function>',
      []
    );
    assert.equal(r.toolCalls.length, 0);
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

  it('salvages llama-style <function=...> markup at end of stream', async () => {
    const events: string[] = [];
    const it = ollamaStreamToAnthropicSSE(
      (async function* () {
        yield {
          message: {
            content:
              "I'll list /tmp.\n<function=Bash>\n<parameter=command>\nls /tmp\n</parameter>\n</function>\n</tool_call>",
          },
        };
        yield { done: true, eval_count: 5, prompt_eval_count: 100 };
      })(),
      { requestModel: 'qwen3-coder:30b', knownTools: ['Bash', 'Read'] }
    );
    for await (const e of it) events.push(e);

    const tu = events.find((e) => e.includes('"type":"tool_use"'));
    assert.ok(tu, 'expected a tool_use content_block_start');
    assert.match(tu!, /"name":"Bash"/);
    const delta = events.find((e) => e.includes('input_json_delta'));
    assert.ok(delta);
    assert.match(delta!, /\\"command\\":\\"ls \/tmp\\"/);
    const msgDelta = events.find((e) => e.includes('"type":"message_delta"'));
    assert.match(msgDelta!, /"stop_reason":"tool_use"/);
  });

  it('does not salvage when no tools were declared in the request', async () => {
    const events: string[] = [];
    const it = ollamaStreamToAnthropicSSE(
      (async function* () {
        yield {
          message: {
            content: '<function=Bash><parameter=command>ls</parameter></function>',
          },
        };
        yield { done: true };
      })(),
      { requestModel: 'm' }
    );
    for await (const e of it) events.push(e);
    const hasTu = events.some((e) => e.includes('"type":"tool_use"'));
    assert.equal(hasTu, false);
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

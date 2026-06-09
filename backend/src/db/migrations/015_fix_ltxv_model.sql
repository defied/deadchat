UPDATE providers
SET config = json_set(config, '$.defaultModel', 'ltxv-2b-0.9.8-distilled-fp8.safetensors')
WHERE kind = 'local_comfyui'
  AND capability = 'video'
  AND json_extract(config, '$.defaultModel') = 'ltx-video.safetensors';

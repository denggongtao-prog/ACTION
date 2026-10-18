import { it,expect } from 'vitest';
import { taskToJson,taskFromJson } from '../src/lib/taskJson';
import { scenarioJob } from '../src/lib/scenarios';
import { sha256 } from '../src/core/hash';
it('任务JSON保留二进制模型并去除内部预处理数组',()=>{
  const task=scenarioJob('meshstock');
  const json=taskToJson(task),parsed=taskFromJson(json);
  expect(parsed.assets[0].buffer).toBeInstanceOf(ArrayBuffer);
  expect(new Uint8Array(parsed.assets[0].buffer!)).toEqual(new Uint8Array(task.assets[0].buffer!));
  expect(json).not.toContain('preparedMeshes');
});
it('程序摘要匹配标准SHA-256向量并保留换行差异',()=>{
  expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(sha256('a\r\nb')).not.toBe(sha256('a\nb'));
});

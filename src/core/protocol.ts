import { InputError } from './types';
import {version as engineVersion} from '../../package.json';
export type Identity = { jobId: string; revision: number; runId: string };
export type Envelope = {
  protocol: 'cnc-sim'; version: '1.0'; type: string; messageId: string; channelId: string;
  jobId?: string; revision?: number; runId?: string; payload: Record<string, unknown>; replyTo?: string;
};
export type CommandReply = { type: string; payload: Record<string, unknown> };
export const capabilities = {
  dialectId: 'milling-basic-v1', toolChange: 'configured_xyz_or_logical',
  materialRemoval: true, stockRepresentation:'z_dexel',collisionDetection: 'conservative_sweep_refinement', machineKinematics: 'configured_xyz',
  modelFormats: ['glb', 'stl'], modelRoles: ['stock', 'fixture', 'machine', 'target'],
  maxAssetBytes: 33554432, maxProgramCharacters: 512000,
  cutterCompensation:'g17_line_arc_lookahead',cannedCycles:['G81'],polarCoordinates:'g90_g17',fixedToolAxes:['+Z','-Y'],toolProfiles:['flat_endmill','ball_endmill','drill','profile_endmill'],
  toolChangeAnimation:{mode:'illustrative',durationMs:4000,collisionCoverage:'configured_xyz_and_clamp_only'},
  collisionResponses:['pause','warn_continue'],warningScope:'first_contact_per_instruction',
};
const commands = new Set(['LOAD_JOB','START','PAUSE','RESUME','RESET','STEP','SEEK_LINE','SET_SPEED','GET_STATE','GET_REPORT','EVENT_ACK','PING']);
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a,b)) return true;
  if (a instanceof ArrayBuffer && b instanceof ArrayBuffer) {
    const aa = new Uint8Array(a), bb = new Uint8Array(b);
    return aa.length === bb.length && aa.every((x,i) => x === bb[i]);
  }
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const aa = Object.keys(a), bb = Object.keys(b);
  return aa.length === bb.length && aa.every(k => Object.hasOwn(b,k) && same((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k]));
}
export class ProtocolSession {
  private channel: string | null = null; private origin: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private acceptedRevisions = new Map<string, number>();
  private cache = new Map<string, { request: Envelope; reply: Promise<Envelope> }>();
  constructor(private allowedOrigins: string[], private execute: (message: Envelope) => Promise<CommandReply>, private identity: () => Identity | null = () => null, private acknowledge?: (message: Envelope) => boolean | Promise<boolean>) {}
  private reply(request: Envelope, result: CommandReply): Envelope {
    return { protocol:'cnc-sim',version:'1.0',messageId:crypto.randomUUID(),channelId:request.channelId,replyTo:request.messageId,...this.identity(),...result };
  }
  private error(request: Envelope, error: unknown) {
    return this.reply(request,{type:'COMMAND_ERROR',payload:{code:error instanceof InputError?error.code:'COMMAND_ERROR',message:error instanceof Error?error.message:'命令失败',physicalLine:error instanceof InputError?error.physicalLine:undefined}});
  }
  async receive(raw: unknown, origin: string, sourceMatches: boolean): Promise<Envelope | undefined> {
    if (!sourceMatches || !this.allowedOrigins.includes(origin) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    const m = raw as Envelope;
    if (m.protocol !== 'cnc-sim' || typeof m.type !== 'string' || typeof m.messageId !== 'string' || m.messageId.length > 128 || !m.messageId || typeof m.channelId !== 'string' || m.channelId.length < 8 || m.channelId.length > 128) return;
    if (m.type === 'HELLO') {
      if (m.version !== '1.0') return this.error(m,new InputError('协议版本不兼容'));
      if (!m.payload || typeof m.payload !== 'object' || Array.isArray(m.payload)) return this.error(m,new InputError('payload必须是对象'));
      if (this.channel && (m.channelId !== this.channel || this.origin !== origin)) return this.error(m,new InputError('会话已绑定，请重新载入iframe'));
      this.channel = m.channelId; this.origin = origin;
      return this.reply(m,{type:'SIM_READY',payload:{capabilities,engineVersion}});
    }
    if (m.channelId !== this.channel || origin !== this.origin) return;
    if (m.version !== '1.0' || !commands.has(m.type)) return this.error(m,new InputError('协议版本或命令不支持'));
    if (!m.payload || typeof m.payload !== 'object' || Array.isArray(m.payload)) return this.error(m,new InputError('payload必须是对象'));
    if (m.type !== 'PING' && (typeof m.jobId !== 'string' || !m.jobId || m.jobId.length>128 || !Number.isSafeInteger(m.revision) || m.revision! < 1 || typeof m.runId !== 'string' || !m.runId || m.runId.length>128)) return this.error(m,new InputError('任务标识不完整'));
    if (m.type === 'EVENT_ACK' && (typeof m.payload.eventId !== 'string' || !m.payload.eventId || m.payload.eventId.length > 128)) return this.error(m,new InputError('EVENT_ACK缺少有效eventId'));
    const cached = this.cache.get(m.messageId);
    if (cached) return same(cached.request,m) ? cached.reply : this.error(m,new InputError('重复messageId的内容不一致',undefined,'MESSAGE_CONFLICT'));
    let saved: Envelope;
    try { saved = structuredClone(m); } catch { return this.error(m,new InputError('消息无法复制')); }
    const promise = this.queue.then(async () => {
      try {
        const current = this.identity();
        // ACK belongs to the original event identity; RESET must not make it unacknowledgeable.
        if (saved.type === 'EVENT_ACK' && this.acknowledge) {
          if (!await this.acknowledge(saved)) throw new InputError('事件身份或通道不匹配',undefined,'UNKNOWN_EVENT');
          return {...this.reply(saved,{type:'COMMAND_ACK',payload:{eventId:saved.payload.eventId}}),jobId:saved.jobId,revision:saved.revision,runId:saved.runId};
        }
        if (saved.type === 'LOAD_JOB') {
          const latest = Math.max(this.acceptedRevisions.get(saved.jobId!) ?? 0, current && current.jobId === saved.jobId ? current.revision : 0);
          if (saved.revision! <= latest) throw new InputError('载入修订已过期或被复用；新载入需递增revision',undefined,'STALE_REVISION');
        }
        if (current && !['LOAD_JOB','PING'].includes(saved.type) && (saved.jobId !== current.jobId || saved.revision !== current.revision || saved.runId !== current.runId)) throw new InputError('任务版本已失效',undefined,'STALE_RUN');
        if (saved.type === 'PING') return this.reply(saved,{type:'PONG',payload:{}});
        const result = await this.execute(saved);
        if (saved.type === 'LOAD_JOB' && result.type === 'JOB_READY') this.acceptedRevisions.set(saved.jobId!,saved.revision!);
        return this.reply(saved,result);
      } catch(e) { return this.error(saved,e); }
    });
    this.queue = promise;
    this.cache.set(m.messageId,{request:saved,reply:promise});
    if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
    return promise;
  }
  event(type: string, payload: Record<string, unknown>): Envelope | null {
    if (!this.channel) return null;
    return structuredClone({protocol:'cnc-sim',version:'1.0',type,messageId:crypto.randomUUID(),channelId:this.channel,...this.identity(),payload});
  }
  get channelId() { return this.channel; }
  get targetOrigin() { return this.origin; }
}


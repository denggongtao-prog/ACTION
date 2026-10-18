/** Standalone declarations: copy this file beside cnc-sim-client.js. */
export type Identity={jobId:string;revision:number;runId:string};
export type ConnectionState='disconnected'|'connecting'|'connected'|'disposed';
export type Point3=[number,number,number];
export type Envelope<T=Record<string,unknown>>={protocol:'cnc-sim';version:'1.0';type:string;messageId:string;channelId:string;jobId?:string;revision?:number;runId?:string;replyTo?:string;payload:T};
export type Tool={toolId:string;toolNumber:number;type:'flat_endmill'|'ball_endmill'|'drill'|'profile_endmill';diameterMm:number;cuttingLengthMm:number;gaugeLengthMm:number;shaftDiameterMm:number;holder:{diameterMm:number;lengthMm:number};requiredSpindleDirection?:'CW'|'CCW';axisDirection?:{x:number;y:number;z:number};radialProfile?:{zMm:number;radiusMm:number}[]};
export type Asset={objectId:string;role:'stock'|'target'|'fixture'|'machine';format:'glb'|'stl';unit:'mm'|'m';sha256?:string;poseInM?:{translationMm:Point3;quaternionXYZW:[number,number,number,number]};nodes?:{nodeName:string;objectId:string;role:Asset['role']}[]}&({url:string;buffer?:never}|{buffer:ArrayBuffer;url?:never});
export type Job={
  program:{programId:string;text:string;sha256?:string;lineEnding?:string};stock:{objectId:string;kind:'box'|'mesh';assetId?:string;sizeMm?:Point3;minCornerInW?:Point3};tools:Tool[];
  initialPositionMm?:Point3;assets?:Asset[];dialectId?:'milling-basic-v1'|'milling-preview-v1';
  simulation?:{stockCellMm?:number;arcChordToleranceMm?:number;mode?:'cut'|'dry_run';checkCollisions?:boolean;stopOnCollision?:boolean;contactLocalizationMm?:number;maxCollisionQueries?:number;maxMemoryMb?:number};
  initialAxisPositionMm?:{x:number;y:number;z:number};workOffsetsMm?:Record<string,{x:number;y:number;z:number}>;toolLengthOffsetsMm?:Record<string,number>;toolLengthReferenceMm?:number;cutterRadiusOffsetsMm?:Record<string,number>;machineProfile?:Record<string,unknown>;machineProfileId?:string;optionalStop?:boolean;
};
export type RequestOptions={identity?:Identity|null;timeoutMs?:number;retries?:number};
export type ClientOptions={onMessage?:(message:Envelope)=>void|Promise<void>;onEvent?:(message:Envelope)=>void|Promise<void>;onError?:(error:Error)=>void|Promise<void>;onConnectionChange?:(state:ConnectionState)=>void|Promise<void>;persistEvent?:(message:Envelope)=>boolean|void|Promise<boolean|void>};
export const CRITICAL_EVENTS:Set<string>;
export class CncSimClient{
  constructor(frame:HTMLIFrameElement,url:string,options?:ClientOptions);
  readonly identity:Identity|null;readonly channelId:string;readonly connected:boolean;readonly loaded:boolean;readonly disposed:boolean;readonly connectionState:ConnectionState;
  readonly ready?:{engineVersion:string;capabilities:Record<string,unknown>;history?:unknown[];persistenceError?:string|null};
  onMessage:NonNullable<ClientOptions['onMessage']>;onEvent:NonNullable<ClientOptions['onEvent']>;onError:NonNullable<ClientOptions['onError']>;onConnectionChange:NonNullable<ClientOptions['onConnectionChange']>;persistEvent:NonNullable<ClientOptions['persistEvent']>;
  connect():Promise<Envelope>;loadJob(job:Job,options?:{jobId?:string;revision?:number;runId?:string}):Promise<Envelope>;
  request(type:string,payload?:Record<string,unknown>,options?:RequestOptions):Promise<Envelope>;
  start():Promise<Envelope>;pause():Promise<Envelope>;resume():Promise<Envelope>;step():Promise<Envelope>;reset():Promise<Envelope>;seekLine(physicalLine:number):Promise<Envelope>;setSpeed(speed:number):Promise<Envelope>;
  getState(identity?:Identity):Promise<Envelope>;getReport(identity?:Identity):Promise<Envelope>;dispose():void;
}

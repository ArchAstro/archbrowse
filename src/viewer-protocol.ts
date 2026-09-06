import type { Geometry } from './kitty.js';
import { AgentError, agentSocket } from './agent/protocol.js';

export function viewerSocket(name:string) {
  const socket=agentSocket(name);
  return process.platform==='win32'?socket+'-view':socket.endsWith('agent.sock')?socket.slice(0,-10)+'view.sock':socket.slice(0,-1)+'v';
}
export interface ViewerGeometry { geometry:Geometry; pixel:boolean }
export function validateGeometry(value:unknown):ViewerGeometry {
  const v=value as ViewerGeometry, g=v?.geometry;
  if(!g || typeof v.pixel!=='boolean' || ![g.columns,g.rows].every(n=>Number.isInteger(n)&&n>0&&n<=1000)
    || ![g.cellWidth,g.cellHeight].every(n=>Number.isFinite(n)&&n>0&&n<=256)
    || g.columns*g.cellWidth>16384 || g.rows*g.cellHeight>16384)throw new AgentError('invalid_geometry','Invalid viewer geometry.');
  return {geometry:{columns:g.columns,rows:g.rows,cellWidth:g.cellWidth,cellHeight:g.cellHeight},pixel:v.pixel};
}

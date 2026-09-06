import React, { useState } from 'react';
import './style.css';
export default function App() {
  const [count, setCount] = useState(0), [name, setName] = useState(''), [enabled, setEnabled] = useState(true), [level, setLevel] = useState('35');
  return <main>
    <header><span className="mark">A↗</span><span>ARCHBROWSE <small>LIVE WORKSPACE</small></span><b className="live">● Connected</b></header>
    <section className="hero"><p className="eyebrow">CHROMIUM PIXELS. TERMINAL KEYS.</p><h1>A real app.<br/><em>Right here.</em></h1><p>Your components, CSS, and browser APIs — running inside the terminal.</p></section>
    <section className="grid">
      <article><span className="label">01 / INTERACTION</span><h2>Make something happen.</h2><p>Mouse, keyboard, or touch. Same React state.</p><button id="counter" onClick={() => setCount(count + 1)}>Launches <strong>{count}</strong><span>↗</span></button><output id="count">{count} launches</output></article>
      <article><span className="label">02 / INPUT</span><h2>Leave your signature.</h2><label htmlFor="name">Your name</label><input id="name" placeholder="Type something…" value={name} onChange={e => setName(e.target.value)}/><p id="greeting">{name ? `Hello, ${name}.` : 'Unicode and pasted text welcome.'}</p></article>
      <article><span className="label">03 / NATIVE CONTROLS</span><h2>Find your frequency.</h2><label className="toggle"><input id="enabled" type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}/> Signal {enabled ? 'on' : 'off'}</label><input id="level" aria-label="Level" type="range" value={level} onChange={e => setLevel(e.target.value)}/><output id="level-value">{level}%</output><select aria-label="Mode" defaultValue="Orbit"><option>Orbit</option><option>Launch</option><option>Land</option></select></article>
    </section>
    <section className="tail"><span className="label">04 / KEEP EXPLORING</span><h2>Room to move.</h2><p>Scroll down. Resize the terminal. Edit this file and watch it rebuild.</p><a href="#top" onClick={() => window.scrollTo(0, 0)}>Back to the surface ↑</a></section>
    <footer>BUILT WITH REACT · RENDERED BY CHROMIUM <span>CTRL + Q TO LEAVE</span></footer>
  </main>;
}

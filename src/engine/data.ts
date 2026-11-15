/** Shared authored data contracts. Type-only imports require neither Phaser nor React.
 * Types are single-sourced from the renderer-independent core barrel, so adding an engine
 * module to core.ts automatically publishes its data contracts here.
 */
export type * from './core.js';

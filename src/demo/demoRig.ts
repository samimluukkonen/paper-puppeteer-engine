import { parseRigDefinition } from '../engine/externalData.js';
import definition from './data/demo-rig.json';

export const demoRig = parseRigDefinition(definition);

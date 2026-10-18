import { z } from 'zod';
import { sceneDefinitionSchema } from './SceneDefinition.js';
import {
  animationFileSchema,
  characterManifestSchema,
  poseDefinitionSchema,
  rigFileSchema,
  skinFileSchema,
} from './schemas.js';

/** Editor schemas describe file shapes; rig references and timelines use shared semantic checks. */
export function generateJsonSchemas() {
  const definitions = {
    rig: { schema: rigFileSchema, title: 'Paper Puppeteer rig' },
    animation: { schema: animationFileSchema, title: 'Paper Puppeteer animation' },
    skin: { schema: skinFileSchema, title: 'Paper Puppeteer skin' },
    pose: { schema: poseDefinitionSchema, title: 'Paper Puppeteer static pose' },
    character: { schema: characterManifestSchema, title: 'Paper Puppeteer character manifest' },
    scene: { schema: sceneDefinitionSchema, title: 'Paper Puppeteer scene' },
  };
  return Object.fromEntries(
    Object.entries(definitions).map(([name, { schema, title }]) => [
      `${name}.schema.json`,
      { ...z.toJSONSchema(schema, { io: 'input' }), title },
    ]),
  );
}

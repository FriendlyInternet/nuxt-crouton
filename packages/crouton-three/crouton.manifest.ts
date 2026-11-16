import { defineCroutonManifest } from '@fyit/crouton-core/shared/manifest'

export default defineCroutonManifest({
  id: 'crouton-three',
  name: 'Three',
  description: 'TresJS (Three.js for Vue) integration — flexible 3D scenes, a glTF/.glb model viewer, keyboard controls, and a 3D model pages block. Build interactive 3D content and games inside a crouton app.',
  icon: 'i-lucide-box',
  version: '0.1.0',
  category: 'addon',
  aiHint: 'use when app needs 3D rendering, WebGL scenes, glTF/glb model display, or interactive 3D/game experiences',

  // Registers as 'three' app — detectable via useCroutonApps().hasApp('three')
  croutonApp: {
    id: 'three',
  },

  dependencies: [],

  // No collections — this is a UI/composable-only package
  collections: [],

  provides: {
    composables: [
      'useThreeControls',
    ],
    components: [
      {
        name: 'CroutonThreeScene',
        description: 'TresJS canvas wrapper with camera, lights, optional orbit controls, and a default slot for arbitrary 3D content (meshes, models, game objects)',
      },
      {
        name: 'CroutonThreeModelViewer',
        description: 'glTF/.glb model viewer with orbit controls and auto-rotate; renders a placeholder when no model is set',
      },
      {
        name: 'CroutonThreeStarterScene',
        description: 'Runnable game starter — a WASD / arrow-key controllable cube on a ground plane (uses useThreeControls)',
      },
    ],
    apiRoutes: [],
    editorBlocks: [
      { type: 'modelBlock', name: '3D Model', description: 'Embed an interactive glTF/.glb 3D model', icon: 'i-lucide-box', category: 'content' },
    ],
  },

  // Detection patterns — schema fields that hint at 3D model data
  detects: {
    fieldNamePatterns: [
      'model3d', 'gltf', 'glb', 'modelurl', 'modelsrc',
    ],
  },
})

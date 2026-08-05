<script setup lang="ts">
// The ORIGINAL ko-ui showcase (#1304) — resurrected verbatim from the retired
// apps/ko-ui app (git 1129c8a8, removed by "chore(root): remove ko-ui app").
// It mocks a full KO II device: custom Ko* components (buttons with LED slots,
// knobs, 7-segment displays, punch holes, speaker grills) side-by-side with
// the same aesthetic done through Nuxt UI `variant="ko"`. Only this comment
// and the back-link differ from the original.

// Demo state
const knobValue = ref(50)
const bpmKnob = ref(120)
const isRecording = ref(false)
const isPlaying = ref(false)

// Toggle handlers
const toggleRecord = () => {
  isRecording.value = !isRecording.value
}

const togglePlay = () => {
  isPlaying.value = !isPlaying.value
}
</script>

<template>
  <div class="min-h-screen bg-[var(--ko-surface-light)] p-8">
    <!-- Header -->
    <header class="mb-12">
      <h1 class="ko-font text-3xl text-[var(--ko-text-dark)] mb-2">
        KO-UI
      </h1>
      <p class="text-[var(--ko-text-label)] text-sm">
        Hardware-inspired design system based on Teenage Engineering KO II —
        the original ko-ui showcase, resurrected.
      </p>
      <NuxtLink to="/" class="text-xs text-[var(--ko-accent-orange)] font-mono underline underline-offset-2">
        ← back to the theme gallery
      </NuxtLink>
    </header>

    <!-- Main Grid -->
    <div class="grid gap-12">
      <!-- ============================================
           SECTION: Buttons
           ============================================ -->
      <section>
        <h2 class="ko-font text-lg text-[var(--ko-text-dark)] mb-6 border-b border-[var(--ko-surface-mid)] pb-2">
          Buttons
        </h2>

        <!-- Square Buttons Comparison -->
        <div class="mb-8">
          <h3 class="text-sm text-[var(--ko-text-label)] mb-4">Square Buttons</h3>

          <!-- Custom KoButton -->
          <p class="text-xs text-[var(--ko-accent-orange)] mb-2 font-mono">&lt;KoButton&gt; (custom)</p>
          <div class="flex flex-wrap gap-4 mb-4">
            <div class="flex flex-col items-center gap-2">
              <KoLabel>Keys</KoLabel>
              <KoButton variant="default" shape="square">
                Keys
              </KoButton>
            </div>

            <div class="flex flex-col items-center gap-2">
              <KoLabel variant="orange">Sample</KoLabel>
              <KoButton variant="orange" shape="square">
                X
                <template #led>
                  <KoLed state="on" />
                </template>
              </KoButton>
            </div>

            <div class="flex flex-col items-center gap-2">
              <KoLabel>Dark</KoLabel>
              <KoButton variant="dark" shape="square">
                7
              </KoButton>
            </div>

            <div class="flex flex-col items-center gap-2">
              <KoLabel>Pink</KoLabel>
              <KoButton variant="pink" shape="square">
                FX
              </KoButton>
            </div>

            <div class="flex flex-col items-center gap-2">
              <KoLabel>Blue</KoLabel>
              <KoButton variant="blue" shape="square">
                Y
              </KoButton>
            </div>

            <div class="flex flex-col items-center gap-2">
              <KoLabel>Red</KoLabel>
              <KoButton
                variant="red"
                shape="square"
                @click="toggleRecord"
              >
                Rec
                <template #led>
                  <KoLed :state="isRecording ? 'blink' : 'off'" color="red" />
                </template>
              </KoButton>
            </div>
          </div>

          <!-- Nuxt UI via variant="ko" (config-based) -->
          <p class="text-xs text-[var(--ko-accent-orange)] mb-2 font-mono">&lt;UButton variant="ko"&gt; (config variant)</p>
          <div class="flex flex-wrap gap-4">
            <div class="flex flex-col items-center gap-2">
              <KoLabel>Keys</KoLabel>
              <UButton variant="ko" class="aspect-square p-4">
                Keys
              </UButton>
            </div>

            <div class="flex flex-col items-center gap-2">
              <KoLabel variant="orange">Sample</KoLabel>
              <UButton variant="ko" color="primary" class="aspect-square p-4">
                X
              </UButton>
            </div>

            <div class="flex flex-col items-center gap-2">
              <KoLabel>Dark</KoLabel>
              <UButton variant="ko" color="neutral" class="aspect-square p-4">
                7
              </UButton>
            </div>

            <div class="flex flex-col items-center gap-2">
              <KoLabel>Pink</KoLabel>
              <UButton variant="ko" color="secondary" class="aspect-square p-4">
                FX
              </UButton>
            </div>

            <div class="flex flex-col items-center gap-2">
              <KoLabel>Blue</KoLabel>
              <UButton variant="ko" color="info" class="aspect-square p-4">
                Y
              </UButton>
            </div>

            <div class="flex flex-col items-center gap-2">
              <KoLabel>Red</KoLabel>
              <UButton variant="ko" color="error" class="aspect-square p-4">
                Rec
              </UButton>
            </div>
          </div>
        </div>

        <!-- Rectangular Buttons Comparison -->
        <div class="mb-8">
          <h3 class="text-sm text-[var(--ko-text-label)] mb-4">Rectangular Buttons</h3>

          <!-- Custom KoButton -->
          <p class="text-xs text-[var(--ko-accent-orange)] mb-2 font-mono">&lt;KoButton&gt; (custom)</p>
          <div class="flex flex-wrap gap-4 mb-4">
            <div class="flex flex-col items-center gap-2">
              <KoLabel>Sound</KoLabel>
              <KoButton variant="default" shape="rect">
                Edit
              </KoButton>
            </div>

            <div class="flex flex-col items-center gap-2">
              <KoLabel variant="orange">Main</KoLabel>
              <KoButton variant="orange" shape="rect">
                Commit
              </KoButton>
            </div>

            <div class="flex flex-col items-center gap-2">
              <KoLabel>Tempo</KoLabel>
              <KoButton variant="dark" shape="rect">
                Loop
              </KoButton>
            </div>
          </div>

          <!-- Nuxt UI via variant="ko" -->
          <p class="text-xs text-[var(--ko-accent-orange)] mb-2 font-mono">&lt;UButton variant="ko"&gt;</p>
          <div class="flex flex-wrap gap-4">
            <div class="flex flex-col items-center gap-2">
              <KoLabel>Sound</KoLabel>
              <UButton variant="ko" class="px-4 py-2">
                Edit
              </UButton>
            </div>

            <div class="flex flex-col items-center gap-2">
              <KoLabel variant="orange">Main</KoLabel>
              <UButton variant="ko" color="primary" class="px-4 py-2">
                Commit
              </UButton>
            </div>

            <div class="flex flex-col items-center gap-2">
              <KoLabel>Tempo</KoLabel>
              <UButton variant="ko" color="neutral" class="px-4 py-2">
                Loop
              </UButton>
            </div>
          </div>
        </div>

        <!-- Number Pad Comparison -->
        <div>
          <h3 class="text-sm text-[var(--ko-text-label)] mb-4">Number Pad</h3>
          <div class="flex gap-8">
            <!-- Custom -->
            <div>
              <p class="text-xs text-[var(--ko-accent-orange)] mb-2 font-mono">&lt;KoButton&gt;</p>
              <div class="grid grid-cols-3 gap-1 w-fit">
                <KoButton variant="dark" shape="square">7</KoButton>
                <KoButton variant="dark" shape="square">8</KoButton>
                <KoButton variant="dark" shape="square">9</KoButton>
                <KoButton variant="dark" shape="square">4</KoButton>
                <KoButton variant="dark" shape="square">5</KoButton>
                <KoButton variant="dark" shape="square">6</KoButton>
                <KoButton variant="dark" shape="square">1</KoButton>
                <KoButton variant="dark" shape="square">2</KoButton>
                <KoButton variant="dark" shape="square">3</KoButton>
              </div>
            </div>

            <!-- Nuxt UI -->
            <div>
              <p class="text-xs text-[var(--ko-accent-orange)] mb-2 font-mono">&lt;UButton variant="ko" color="neutral"&gt;</p>
              <div class="grid grid-cols-3 gap-2 w-fit">
                <UButton variant="ko" color="neutral" class="aspect-square p-4">7</UButton>
                <UButton variant="ko" color="neutral" class="aspect-square p-4">8</UButton>
                <UButton variant="ko" color="neutral" class="aspect-square p-4">9</UButton>
                <UButton variant="ko" color="neutral" class="aspect-square p-4">4</UButton>
                <UButton variant="ko" color="neutral" class="aspect-square p-4">5</UButton>
                <UButton variant="ko" color="neutral" class="aspect-square p-4">6</UButton>
                <UButton variant="ko" color="neutral" class="aspect-square p-4">1</UButton>
                <UButton variant="ko" color="neutral" class="aspect-square p-4">2</UButton>
                <UButton variant="ko" color="neutral" class="aspect-square p-4">3</UButton>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ============================================
           SECTION: LEDs
           ============================================ -->
      <section>
        <h2 class="ko-font text-lg text-[var(--ko-text-dark)] mb-6 border-b border-[var(--ko-surface-mid)] pb-2">
          LEDs
        </h2>

        <div class="flex flex-wrap gap-8">
          <!-- States -->
          <div>
            <h3 class="text-sm text-[var(--ko-text-label)] mb-4">States</h3>
            <div class="flex gap-4 items-center bg-[var(--ko-surface-panel)] p-4 rounded">
              <div class="flex flex-col items-center gap-2">
                <KoLed state="off" />
                <span class="text-xs text-[var(--ko-text-label)]">Off</span>
              </div>
              <div class="flex flex-col items-center gap-2">
                <KoLed state="on" />
                <span class="text-xs text-[var(--ko-text-label)]">On</span>
              </div>
              <div class="flex flex-col items-center gap-2">
                <KoLed state="blink" />
                <span class="text-xs text-[var(--ko-text-label)]">Blink</span>
              </div>
              <div class="flex flex-col items-center gap-2">
                <KoLed state="fast" />
                <span class="text-xs text-[var(--ko-text-label)]">Fast</span>
              </div>
              <div class="flex flex-col items-center gap-2">
                <KoLed state="alive" />
                <span class="text-xs text-[var(--ko-text-label)]">Alive</span>
              </div>
            </div>
          </div>

          <!-- Colors -->
          <div>
            <h3 class="text-sm text-[var(--ko-text-label)] mb-4">Colors</h3>
            <div class="flex gap-4 items-center bg-[var(--ko-surface-panel)] p-4 rounded">
              <div class="flex flex-col items-center gap-2">
                <KoLed state="on" color="orange" />
                <span class="text-xs text-[var(--ko-text-label)]">Orange</span>
              </div>
              <div class="flex flex-col items-center gap-2">
                <KoLed state="on" color="red" />
                <span class="text-xs text-[var(--ko-text-label)]">Red</span>
              </div>
              <div class="flex flex-col items-center gap-2">
                <KoLed state="on" color="blue" />
                <span class="text-xs text-[var(--ko-text-label)]">Blue</span>
              </div>
              <div class="flex flex-col items-center gap-2">
                <KoLed state="on" color="green" />
                <span class="text-xs text-[var(--ko-text-label)]">Green</span>
              </div>
            </div>
          </div>

          <!-- Sizes -->
          <div>
            <h3 class="text-sm text-[var(--ko-text-label)] mb-4">Sizes</h3>
            <div class="flex gap-4 items-center bg-[var(--ko-surface-panel)] p-4 rounded">
              <div class="flex flex-col items-center gap-2">
                <KoLed state="on" size="sm" />
                <span class="text-xs text-[var(--ko-text-label)]">sm</span>
              </div>
              <div class="flex flex-col items-center gap-2">
                <KoLed state="on" size="md" />
                <span class="text-xs text-[var(--ko-text-label)]">md</span>
              </div>
              <div class="flex flex-col items-center gap-2">
                <KoLed state="on" size="lg" />
                <span class="text-xs text-[var(--ko-text-label)]">lg</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ============================================
           SECTION: Knobs
           ============================================ -->
      <section>
        <h2 class="ko-font text-lg text-[var(--ko-text-dark)] mb-6 border-b border-[var(--ko-surface-mid)] pb-2">
          Knobs
        </h2>

        <div class="flex flex-wrap gap-8">
          <!-- Volume Knob -->
          <div class="flex flex-col items-center gap-2">
            <KoLabel>Volume</KoLabel>
            <KoKnob v-model="knobValue" size="lg" />
            <KoLabel variant="dark" position="below">{{ knobValue }}</KoLabel>
          </div>

          <!-- BPM Knob -->
          <div class="flex flex-col items-center gap-2">
            <KoLabel variant="orange">BPM</KoLabel>
            <KoKnob v-model="bpmKnob" :min="60" :max="200" size="md" color="orange" />
            <KoLabel variant="dark" position="below">{{ bpmKnob }}</KoLabel>
          </div>

          <!-- Small Knobs -->
          <div class="flex flex-col items-center gap-2">
            <KoLabel>Gain</KoLabel>
            <KoKnob :model-value="75" size="sm" />
          </div>
        </div>
      </section>

      <!-- ============================================
           SECTION: Displays
           ============================================ -->
      <section>
        <h2 class="ko-font text-lg text-[var(--ko-text-dark)] mb-6 border-b border-[var(--ko-surface-mid)] pb-2">
          Displays
        </h2>

        <div class="flex flex-wrap gap-8">
          <KoDisplay label="BAR" :value="'19.3'" />
          <KoDisplay label="BPM" :value="bpmKnob" />
          <KoDisplay :value="'FX'" :segments="false" />
        </div>
      </section>

      <!-- ============================================
           SECTION: Inputs (Nuxt UI Variant)
           ============================================ -->
      <section>
        <h2 class="ko-font text-lg text-[var(--ko-text-dark)] mb-6 border-b border-[var(--ko-surface-mid)] pb-2">
          Inputs
        </h2>

        <div class="space-y-6 max-w-md">
          <!-- Default Nuxt UI Input -->
          <div>
            <p class="text-xs text-[var(--ko-text-label)] mb-2 font-mono">&lt;UInput&gt; (default)</p>
            <UInput placeholder="Default input..." />
          </div>

          <!-- KO Variant Input -->
          <div>
            <p class="text-xs text-[var(--ko-accent-orange)] mb-2 font-mono">&lt;UInput variant="ko"&gt;</p>
            <UInput variant="ko" placeholder="LCD style input..." />
          </div>

          <!-- KO Input with icon -->
          <div>
            <p class="text-xs text-[var(--ko-accent-orange)] mb-2 font-mono">&lt;UInput variant="ko"&gt; with icon</p>
            <UInput variant="ko" placeholder="Search samples..." icon="i-lucide-search" />
          </div>

          <!-- Multiple inputs in a row -->
          <div>
            <p class="text-xs text-[var(--ko-accent-orange)] mb-2 font-mono">BPM / Bar inputs</p>
            <div class="flex gap-4">
              <UInput variant="ko" placeholder="120" class="w-24" />
              <UInput variant="ko" placeholder="4/4" class="w-24" />
              <UInput variant="ko" placeholder="C" class="w-16" />
            </div>
          </div>
        </div>
      </section>

      <!-- ============================================
           SECTION: Cards (Nuxt UI Variant)
           ============================================ -->
      <section>
        <h2 class="ko-font text-lg text-[var(--ko-text-dark)] mb-6 border-b border-[var(--ko-surface-mid)] pb-2">
          Cards
        </h2>

        <div class="grid gap-6 max-w-2xl">
          <!-- Default Nuxt UI Card -->
          <div>
            <p class="text-xs text-[var(--ko-text-label)] mb-2 font-mono">&lt;UCard&gt; (default)</p>
            <UCard>
              <template #header>
                Default Card Header
              </template>
              <p>This is the default Nuxt UI card styling.</p>
              <template #footer>
                <UButton size="sm">Action</UButton>
              </template>
            </UCard>
          </div>

          <!-- KO Variant Card (Light) -->
          <div>
            <p class="text-xs text-[var(--ko-accent-orange)] mb-2 font-mono">&lt;UCard variant="ko"&gt;</p>
            <UCard variant="ko">
              <template #header>
                Sample Bank
              </template>
              <div class="space-y-2">
                <p>Hardware-styled card with beveled edges and drop shadow.</p>
                <div class="flex gap-2">
                  <UButton variant="ko" size="sm">Load</UButton>
                  <UButton variant="ko" color="primary" size="sm">Save</UButton>
                </div>
              </div>
            </UCard>
          </div>

          <!-- KO Card with inputs inside -->
          <div>
            <p class="text-xs text-[var(--ko-accent-orange)] mb-2 font-mono">KO Card with form</p>
            <UCard variant="ko">
              <template #header>
                Project Settings
              </template>
              <div class="space-y-4">
                <div>
                  <label class="ko-font text-xs text-[var(--ko-text-label)] block mb-1">Project Name</label>
                  <UInput variant="ko" placeholder="My project..." />
                </div>
                <div class="flex gap-4">
                  <div class="flex-1">
                    <label class="ko-font text-xs text-[var(--ko-text-label)] block mb-1">BPM</label>
                    <UInput variant="ko" placeholder="120" />
                  </div>
                  <div class="flex-1">
                    <label class="ko-font text-xs text-[var(--ko-text-label)] block mb-1">Time Sig</label>
                    <UInput variant="ko" placeholder="4/4" />
                  </div>
                </div>
              </div>
              <template #footer>
                <div class="flex justify-end gap-2">
                  <UButton variant="ko" size="sm">Cancel</UButton>
                  <UButton variant="ko" color="primary" size="sm">Save</UButton>
                </div>
              </template>
            </UCard>
          </div>
        </div>
      </section>

      <!-- ============================================
           SECTION: Panels
           ============================================ -->
      <section>
        <h2 class="ko-font text-lg text-[var(--ko-text-dark)] mb-6 border-b border-[var(--ko-surface-mid)] pb-2">
          Panels
        </h2>

        <div class="grid gap-4 max-w-xl">
          <KoPanel :dark="true" :glass="true">
            <div class="flex items-center gap-4">
              <KoLed state="alive" />
              <span>Dark panel with glass effect</span>
            </div>
          </KoPanel>

          <KoPanel :dark="false" :glass="false">
            <span>Light panel without glass</span>
          </KoPanel>
        </div>
      </section>

      <!-- ============================================
           SECTION: Hardware Elements
           ============================================ -->
      <section>
        <h2 class="ko-font text-lg text-[var(--ko-text-dark)] mb-6 border-b border-[var(--ko-surface-mid)] pb-2">
          Hardware Elements
        </h2>

        <div class="flex flex-wrap gap-8">
          <!-- Punch Holes -->
          <div>
            <h3 class="text-sm text-[var(--ko-text-label)] mb-4">Punch Holes</h3>
            <div class="flex gap-4">
              <KoPunchHole size="sm" />
              <KoPunchHole size="md" />
              <KoPunchHole size="lg" />
            </div>
          </div>

          <!-- Speaker Grill -->
          <div>
            <h3 class="text-sm text-[var(--ko-text-label)] mb-4">Speaker Grill</h3>
            <KoSpeakerGrill :rows="8" :cols="6" />
          </div>
        </div>
      </section>

      <!-- ============================================
           SECTION: Complete Demo
           ============================================ -->
      <section>
        <h2 class="ko-font text-lg text-[var(--ko-text-dark)] mb-6 border-b border-[var(--ko-surface-mid)] pb-2">
          Complete Demo
        </h2>

        <div class="bg-[var(--ko-surface-light)] p-6 rounded-lg shadow-xl max-w-2xl">
          <!-- Display Area -->
          <KoPanel :dark="true" :glass="true" class="mb-6">
            <div class="flex items-center justify-between w-full">
              <div class="flex items-center gap-4">
                <KoDisplay label="BAR" value="19.3" />
              </div>
              <div class="flex items-center gap-2">
                <KoLed :state="isPlaying ? 'alive' : 'off'" />
                <KoLed :state="isRecording ? 'blink' : 'off'" color="red" />
              </div>
              <KoSpeakerGrill :rows="6" :cols="4" />
            </div>
          </KoPanel>

          <!-- Controls -->
          <div class="flex items-start gap-6">
            <!-- Left: Volume -->
            <div class="flex flex-col items-center gap-2">
              <KoLabel>Volume</KoLabel>
              <KoKnob v-model="knobValue" size="lg" />
            </div>

            <!-- Center: Transport -->
            <div class="flex gap-2">
              <div class="flex flex-col items-center gap-2">
                <KoLabel>Play</KoLabel>
                <KoButton
                  variant="default"
                  shape="square"
                  @click="togglePlay"
                >
                  ▶
                  <template #led>
                    <KoLed :state="isPlaying ? 'on' : 'off'" color="green" />
                  </template>
                </KoButton>
              </div>

              <div class="flex flex-col items-center gap-2">
                <KoLabel variant="orange">Record</KoLabel>
                <KoButton
                  variant="red"
                  shape="square"
                  @click="toggleRecord"
                >
                  ●
                  <template #led>
                    <KoLed :state="isRecording ? 'blink' : 'off'" color="red" />
                  </template>
                </KoButton>
              </div>
            </div>

            <!-- Right: BPM -->
            <div class="flex flex-col items-center gap-2">
              <KoLabel variant="orange">BPM</KoLabel>
              <KoKnob v-model="bpmKnob" :min="60" :max="200" size="md" color="orange" />
              <KoLabel variant="dark" position="below">{{ bpmKnob }}</KoLabel>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- Footer -->
    <footer class="mt-16 pt-8 border-t border-[var(--ko-surface-mid)]">
      <p class="text-xs text-[var(--ko-text-label)]">
        KO-UI • Inspired by Teenage Engineering KO II
      </p>
    </footer>
  </div>
</template>

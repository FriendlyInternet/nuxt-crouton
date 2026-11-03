<script setup lang="ts">
/**
 * Public-facing werkvergunning submit form.
 * Uses the /api/public/kvr/* endpoints (token-gated, no session).
 * Shares the same visual layout as the admin _Form.vue but has its own submit path.
 */

const props = defineProps<{
  token: string
}>()

const emit = defineEmits<{
  submitted: [result: { id: string, recipientEmail: string, emailStatus: 'sent' | 'failed', emailError?: string }]
}>()

// Provide upload endpoint + token header for Photo/Input children.
provide('kvr-upload-endpoint', '/api/public/kvr/upload')
provide('kvr-upload-headers', { 'x-kvr-token': props.token })

const toast = useToast()

interface Cable {
  id: string
  van?: string
  naar?: string
  buitenSpanningGeaard?: boolean
  losgekoppeld?: boolean
  sleufGeidentificeerd?: boolean
}
interface Photo {
  id: string
  assetId?: string
  caption?: string
}

const state = ref({
  sblNumber: '',
  datum: null as Date | null,
  workType: '',
  cables: Array.from({ length: 4 }, () => ({
    id: crypto.randomUUID(),
    van: '',
    naar: '',
    buitenSpanningGeaard: false,
    losgekoppeld: false,
    sleufGeidentificeerd: false,
  })) as Cable[],
  straat: '',
  huisnummer: '',
  postcode: '',
  gemeente: '',
  ploegLeden: '',
  plaats: '',
  opgemaaktOp: null as Date | null,
  werkverantwoordelijkeNaam: '',
  werkverantwoordelijkeVoornaam: '',
  werkverantwoordelijkeHoedanigheid: '',
  werkverantwoordelijkeAannemer: '',
  werkverantwoordelijkeHandtekening: null as string | null,
  schakelbevoegdeNaam: '',
  schakelbevoegdeVoornaam: '',
  schakelbevoegdeHandtekening: null as string | null,
  photos: [] as Photo[],
})

function addCable() {
  state.value.cables.push({
    id: crypto.randomUUID(),
    van: '',
    naar: '',
    buitenSpanningGeaard: false,
    losgekoppeld: false,
    sleufGeidentificeerd: false,
  })
}

// ---- Date bindings ----
function toDateStr(v: unknown): string {
  if (!v) return ''
  const d = v instanceof Date ? v : new Date(v as string)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}
function toDateTimeLocalStr(v: unknown): string {
  if (!v) return ''
  const d = v instanceof Date ? v : new Date(v as string)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const datumStr = computed({
  get: () => toDateStr(state.value.datum),
  set: (v: string) => { state.value.datum = v ? new Date(v) : null },
})
const opgemaaktStr = computed({
  get: () => toDateTimeLocalStr(state.value.opgemaaktOp),
  set: (v: string) => { state.value.opgemaaktOp = v ? new Date(v) : null },
})

// ---- PDF generation ----
const pdfAreaEl = ref<HTMLElement | null>(null)

async function generateAndUploadPdf(): Promise<string | null> {
  if (!import.meta.client) return null
  const el = pdfAreaEl.value
  if (!el) return null
  try {
    const html2canvas = (await import('html2canvas-pro')).default
    const { jsPDF } = await import('jspdf')

    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      onclone: (doc: Document, clonedEl: HTMLElement) => {
        clonedEl.querySelectorAll('button, [data-pdf-hide], datalist').forEach((n) => {
          (n as HTMLElement).style.display = 'none'
        })

        // Replace text-like inputs with plain divs (values sit on top of an underline, not through it).
        const replaceInputWithText = (input: HTMLInputElement | HTMLTextAreaElement) => {
          const value = input.value || ''
          const div = doc.createElement('div')
          div.textContent = value
          div.style.cssText = `
            min-height: 18px;
            padding: 2px 4px 4px;
            border-bottom: 1px solid #888;
            font-size: 11px;
            line-height: 1.35;
            color: #111;
            white-space: pre-wrap;
            word-break: break-word;
          `
          div.className = input.className
          input.parentElement?.replaceChild(div, input)
        }
        clonedEl.querySelectorAll<HTMLInputElement>(
          'input[type="text"], input[type="email"], input[type="number"]'
        ).forEach(replaceInputWithText)
        clonedEl.querySelectorAll<HTMLTextAreaElement>('textarea').forEach(replaceInputWithText)

        const compactStyle = doc.createElement('style')
        compactStyle.textContent = `
          .pdf-tight { font-size: 11px; }
          .pdf-tight .pt-5 { padding-top: 8px !important; }
          .pdf-tight .pl-5 { padding-left: 10px !important; }
          .pdf-tight .px-5 { padding-left: 10px !important; padding-right: 10px !important; }
          .pdf-tight .px-4 { padding-left: 8px !important; padding-right: 8px !important; }
          .pdf-tight .py-3 { padding-top: 4px !important; padding-bottom: 4px !important; }
          .pdf-tight .py-2 { padding-top: 3px !important; padding-bottom: 3px !important; }
          .pdf-tight .py-1\\.5 { padding-top: 3px !important; padding-bottom: 3px !important; }
          .pdf-tight .py-1 { padding-top: 2px !important; padding-bottom: 2px !important; }
          .pdf-tight .pb-3 { padding-bottom: 4px !important; }
          .pdf-tight .pb-4 { padding-bottom: 4px !important; }
          .pdf-tight .pt-1 { padding-top: 2px !important; }
          .pdf-tight .p-3 { padding: 6px !important; }
          .pdf-tight .mt-1 { margin-top: 2px !important; }
          .pdf-tight .mt-2 { margin-top: 4px !important; }
          .pdf-tight .mb-2 { margin-bottom: 3px !important; }
          .pdf-tight .gap-y-2 { row-gap: 4px !important; }
          .pdf-tight .gap-6 { gap: 12px !important; }
          .pdf-tight .space-y-2 > * + *,
          .pdf-tight .space-y-1 > * + * { margin-top: 3px !important; }
          .pdf-tight canvas { height: 56px !important; }
          .pdf-tight .h-8 { height: 22px !important; }
          .pdf-tight .h-\\[100px\\] { height: 56px !important; }
          .pdf-tight input[type="text"],
          .pdf-tight input[type="email"],
          .pdf-tight input[type="date"],
          .pdf-tight input[type="datetime-local"],
          .pdf-tight input[type="number"],
          .pdf-tight textarea {
            background: transparent !important;
            border: 0 !important;
            border-bottom: 1px solid #888 !important;
            border-radius: 0 !important;
            font-size: 11px !important;
            line-height: 20px !important;
            padding: 0 4px !important;
            color: #111 !important;
          }
          .pdf-tight textarea { min-height: 22px !important; line-height: 1.35 !important; padding: 2px 4px !important; }
          .pdf-tight .divide-y > * { border-top: 0 !important; }
          .pdf-tight [data-opgemaakt-row] { flex-wrap: nowrap !important; gap: 8px !important; }
          .pdf-tight [data-opgemaakt-row] > input[type="text"] { flex: 1 1 auto !important; min-width: 80px !important; }
          .pdf-tight [data-opgemaakt-row] > input[type="datetime-local"] { width: 150px !important; }
          .pdf-tight ul { margin: 2px 0 !important; }
          .pdf-tight li { margin: 1px 0 !important; line-height: 1.25 !important; }
        `
        doc.head.appendChild(compactStyle)
        clonedEl.classList.add('pdf-tight')
        const replaceDateInput = (input: HTMLInputElement, formatted: string) => {
          const div = doc.createElement('div')
          div.textContent = formatted
          div.style.cssText = `
            min-height: 18px;
            padding: 2px 4px 4px;
            border-bottom: 1px solid #888;
            font-size: 11px;
            line-height: 1.35;
            color: #111;
          `
          div.className = input.className
          input.parentElement?.replaceChild(div, input)
        }
        const opgemaaktIso = state.value.opgemaaktOp
          ? new Date(state.value.opgemaaktOp as any)
          : null
        clonedEl.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]').forEach((input) => {
          const formatted = opgemaaktIso
            ? opgemaaktIso.toLocaleString('nl-BE', {
                day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
              })
            : ''
          replaceDateInput(input, formatted)
        })
        const datum = state.value.datum ? new Date(state.value.datum as any) : null
        clonedEl.querySelectorAll<HTMLInputElement>('input[type="date"]').forEach((input) => {
          const formatted = datum
            ? datum.toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : ''
          replaceDateInput(input, formatted)
        })
        const footer = doc.createElement('div')
        footer.style.cssText = 'margin-top:12px;padding:8px 12px;border-top:1px solid #bbb;display:flex;justify-content:space-between;align-items:center;font-size:8px;color:#555;'
        footer.innerHTML = `
          <div>
            <div><strong>Sibelga CVBA</strong></div>
            <div>PB 1340 · 1000 Brussel Brouckère · Tel. 02 549 41 00 · Fax 02 549 46 61 · E-mail: klanten@sibelga.be</div>
            <div>RPR Brussel · BTW BE 0222.869.673 · IBAN BE35 7330 1768 3837 · BIC KREDBEBB</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;font-weight:600;font-size:10px;color:#222">
            <span style="display:inline-block;width:10px;height:10px;border:2.5px solid #c8102e;border-radius:50%"></span>
            <span>Sibelga</span>
          </div>
        `
        clonedEl.appendChild(footer)
      },
    } as any)

    const imgData = canvas.toDataURL('image/jpeg', 0.92)
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' })
    const pageW = pdf.internal.pageSize.getWidth()
    const pageH = pdf.internal.pageSize.getHeight()
    const ratio = canvas.width / canvas.height
    let imgW = pageW
    let imgH = pageW / ratio
    if (imgH > pageH) {
      imgH = pageH
      imgW = pageH * ratio
    }
    const offsetX = (pageW - imgW) / 2
    pdf.addImage(imgData, 'JPEG', offsetX, 0, imgW, imgH, undefined, 'FAST')

    const blob = pdf.output('blob')
    const filename = `werkvergunning-${state.value.sblNumber || 'concept'}.pdf`
    const form = new FormData()
    form.append('file', blob, filename)
    const res = await $fetch<{ pathname: string }>('/api/public/kvr/upload', {
      method: 'POST',
      body: form,
      headers: { 'x-kvr-token': props.token },
    })
    return res.pathname
  }
  catch (err) {
    console.error('[kvr] PDF generation failed:', err)
    return null
  }
}

// ---- Submission ----
const submitting = ref(false)
const submitError = ref<string | null>(null)
const fieldErrors = ref<Array<{ path: string, message: string, label: string }>>([])
const submitDone = ref<null | { sent: boolean, recipient: string }>(null)

function resetForm() {
  submitDone.value = null
  if (typeof window !== 'undefined') {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
}

const fieldLabels: Record<string, string> = {
  sblNumber: 'Nummer SBL',
  datum: 'Datum',
  workType: 'Uit te voeren werk',
  straat: 'Straat',
  huisnummer: 'Nr.',
  postcode: 'Postcode',
  gemeente: 'Gemeente',
  ploegLeden: 'Ploeg leden',
  plaats: 'Opgemaakt te',
  opgemaaktOp: 'Datum & uur',
  werkverantwoordelijkeNaam: 'Naam werkverantwoordelijke',
  werkverantwoordelijkeVoornaam: 'Voornaam werkverantwoordelijke',
  schakelbevoegdeNaam: 'Naam schakelbevoegde',
  schakelbevoegdeVoornaam: 'Voornaam schakelbevoegde',
  cables: 'Kabels',
  photos: "Foto's",
  formPdfPath: 'PDF',
}

function labelFor(path: string) {
  const head = (path || '').split('.')[0]
  return fieldLabels[head] ?? head ?? 'Veld'
}

async function handleSubmit(e: Event) {
  e.preventDefault()
  if (submitting.value) return
  submitting.value = true
  submitError.value = null
  fieldErrors.value = []
  try {
    const pdfPath = await generateAndUploadPdf()
    const payload: any = {
      token: props.token,
      ...state.value,
      formPdfPath: pdfPath ?? null,
    }
    if (payload.datum instanceof Date) payload.datum = payload.datum.toISOString()
    if (payload.opgemaaktOp instanceof Date) payload.opgemaaktOp = payload.opgemaaktOp.toISOString()

    const res = await $fetch<{ id: string, recipientEmail: string, emailStatus: 'sent' | 'failed', emailError?: string }>(
      '/api/public/kvr/submit',
      { method: 'POST', body: payload, headers: { 'x-kvr-token': props.token } },
    )
    submitDone.value = { sent: res.emailStatus === 'sent', recipient: res.recipientEmail }
    emit('submitted', res)

    if (res.emailStatus === 'sent') {
      toast.add({
        title: 'Werkvergunning verstuurd',
        description: `Naar ${res.recipientEmail}`,
        color: 'success',
        icon: 'i-lucide-mail-check',
      })
    }
    else {
      toast.add({
        title: 'Opgeslagen, maar e-mail faalde',
        description: res.emailError || 'Neem contact op met de beheerder.',
        color: 'warning',
        icon: 'i-lucide-mail-warning',
        duration: 10000,
      })
    }
  }
  catch (err: any) {
    const data = err?.data
    const issues = data?.data?.issues ?? data?.issues
    if (Array.isArray(issues) && issues.length > 0) {
      fieldErrors.value = issues.map((iss: any) => ({
        path: iss.path ?? '',
        message: iss.message ?? 'Ongeldig',
        label: labelFor(iss.path ?? ''),
      }))
      submitError.value = 'Controleer de ingevulde velden.'
    }
    else {
      submitError.value = data?.statusMessage || data?.message || err?.message || 'Onbekende fout'
    }
    toast.add({ title: 'Versturen mislukt', description: submitError.value || undefined, color: 'error' })
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <div v-if="submitDone" class="mx-auto max-w-2xl rounded-sm border border-green-300 bg-green-50 p-8 text-center text-green-900">
    <UIcon name="i-lucide-check-circle-2" class="mx-auto size-12 text-green-600" />
    <h2 class="mt-3 text-xl font-semibold">Werkvergunning ingediend</h2>
    <p class="mt-1 text-sm">
      {{ submitDone.sent
        ? `De aanvraag is per e-mail verstuurd naar ${submitDone.recipient}.`
        : `De aanvraag is opgeslagen; de e-mail wordt zo snel mogelijk alsnog verstuurd.` }}
    </p>
    <button
      type="button"
      class="mt-4 rounded-sm bg-neutral-800 px-4 py-2 text-sm text-white hover:bg-neutral-700"
      @click="resetForm"
    >
      Nieuwe werkvergunning
    </button>
  </div>

  <form
    v-else
    class="wvg-form mx-auto max-w-4xl bg-white text-neutral-900 shadow-sm"
    @submit="handleSubmit"
  >
    <div ref="pdfAreaEl">
      <div class="pt-5 pl-5">
        <div class="inline-block rounded-tr-2xl bg-[#5b1f4a] px-4 py-2 text-base font-semibold text-white">
          Werkvergunning voor kabelwerken (WVG)
        </div>
      </div>

      <div class="flex items-center gap-8 px-5 py-3 text-sm">
        <label class="flex items-center gap-2">
          <span class="text-neutral-700">Datum</span>
          <input v-model="datumStr" type="date" class="wvg-input h-8 w-36 px-2" required>
        </label>
        <label class="flex items-center gap-2">
          <span class="text-neutral-700">Nummer SBL</span>
          <input v-model="state.sblNumber" type="text" maxlength="10" class="wvg-input h-8 w-32 px-2 tracking-widest text-center" placeholder="SBL" required>
        </label>
        <div class="ml-auto text-[#5b1f4a] font-bold">
          Nr.&nbsp;<span class="text-xl">077</span>
        </div>
      </div>

      <div class="mx-5 mt-2 rounded-tr-2xl bg-[#5b1f4a] px-3 py-1.5 text-sm font-semibold text-white">
        A. UIT TE VOEREN WERK
      </div>
      <div class="px-5 py-3">
        <div class="flex gap-10">
          <label class="flex items-center gap-2 cursor-pointer text-sm">
            <input v-model="state.workType" type="radio" value="laagspanningslas" class="size-4 accent-[#5b1f4a]" required>
            <span class="text-neutral-800">Laagspanningslas</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer text-sm">
            <input v-model="state.workType" type="radio" value="hoogspanningslas" class="size-4 accent-[#5b1f4a]">
            <span class="text-neutral-800">Hoogspanningslas</span>
          </label>
        </div>
      </div>

      <div class="mx-5 mt-1 rounded-tr-2xl bg-[#5b1f4a] px-3 py-1.5 text-sm font-semibold text-white">
        B. CONSIGNATIE
      </div>

      <div class="mx-5 mt-1 bg-[#7a3668] px-3 py-1 text-xs font-semibold text-white">
        B1. BUITENGEBRUIKSTELLING VAN DE INSTALLATIE
      </div>
      <div class="px-5 py-3">
        <div class="grid grid-cols-[80px_1fr_1fr_130px_130px_110px] items-end gap-2 pb-1 border-b border-neutral-300 text-[10px]">
          <div />
          <div class="text-center text-neutral-700">Van<sup>1</sup></div>
          <div class="text-center text-neutral-700">Naar<sup>2</sup></div>
          <div class="rounded-sm bg-[#5a8b5c] px-2 py-1 text-center text-white leading-tight">Buiten spanning<br>en geaard</div>
          <div class="rounded-sm bg-[#d97a3c] px-2 py-1 text-center text-white leading-tight">Losgekoppeld<br>niet geaard</div>
          <div class="text-center text-neutral-700 leading-tight">In de sleuf<br>geïdentificeerd</div>
        </div>
        <div class="divide-y divide-neutral-200">
          <div
            v-for="(cable, i) in state.cables"
            :key="cable.id"
            class="grid grid-cols-[80px_1fr_1fr_130px_130px_110px] items-center gap-2 py-1.5"
          >
            <div class="pl-1 text-xs font-semibold text-neutral-800">Kabel {{ i + 1 }}</div>
            <input v-model="cable.van" type="text" class="wvg-input h-8 px-2">
            <input v-model="cable.naar" type="text" class="wvg-input h-8 px-2">
            <div class="flex justify-center">
              <input v-model="cable.buitenSpanningGeaard" type="checkbox" class="size-4 accent-[#5b1f4a]">
            </div>
            <div class="flex justify-center">
              <input v-model="cable.losgekoppeld" type="checkbox" class="size-4 accent-[#5b1f4a]">
            </div>
            <div class="flex justify-center">
              <input v-model="cable.sleufGeidentificeerd" type="checkbox" class="size-4 accent-[#5b1f4a]">
            </div>
          </div>
        </div>
        <div class="pt-1 text-[10px] text-neutral-500">
          <sup>1</sup> referentienummer van de verdeeldoos of cabine van vertrek.&nbsp;&nbsp;
          <sup>2</sup> referentienummer van de verdeeldoos of cabine van aankomst.
        </div>
        <button
          type="button"
          class="mt-2 inline-flex items-center gap-1 rounded-sm bg-neutral-800 px-3 py-1 text-xs text-white hover:bg-neutral-700"
          @click="addCable"
        >
          <UIcon name="i-lucide-plus" class="size-3" />
          Kabel toevoegen
        </button>
      </div>

      <div class="mx-5 mt-1 bg-[#7a3668] px-3 py-1 text-xs font-semibold text-white">
        B2. ADRES VAN DE WERKZONE
      </div>
      <div class="px-5 py-3 space-y-2">
        <div class="grid grid-cols-[1fr_140px] gap-4">
          <label class="block text-sm">
            <span class="block text-xs text-neutral-600 mb-0.5">Straat</span>
            <input v-model="state.straat" type="text" class="wvg-input h-8 w-full px-2" required>
          </label>
          <label class="block text-sm">
            <span class="block text-xs text-neutral-600 mb-0.5">Nr.</span>
            <input v-model="state.huisnummer" type="text" class="wvg-input h-8 w-full px-2" required>
          </label>
        </div>
        <div class="grid grid-cols-[200px_1fr] gap-4">
          <label class="block text-sm">
            <span class="block text-xs text-neutral-600 mb-0.5">Postcode</span>
            <input v-model="state.postcode" type="text" inputmode="numeric" maxlength="4" class="wvg-input h-8 w-full px-2" required>
          </label>
          <label class="block text-sm">
            <span class="block text-xs text-neutral-600 mb-0.5">Gemeente</span>
            <input v-model="state.gemeente" type="text" class="wvg-input h-8 w-full px-2" required>
          </label>
        </div>
      </div>

      <div class="mx-5 mt-1 bg-[#7a3668] px-3 py-1 text-xs font-semibold text-white">
        B3. ANDERE INSTALLATIES
      </div>
      <div class="px-5 py-2 text-sm text-neutral-700">
        Alle andere kabels in de sleuf, buiten de hierboven genoemde, moeten beschouwd worden als onder spanning.
      </div>

      <div class="mx-5 mt-2 rounded-tr-2xl bg-[#5b1f4a] px-3 py-1.5 text-sm font-semibold text-white">
        C. BEGIN VAN DE WERKEN
      </div>
      <div class="px-5 py-3 space-y-2 text-sm text-neutral-800">
        <p>De schakelbevoegde van Sibelga geeft eerst toestemming om de werken, beschreven in A, aan te vatten.</p>
        <p>De werkverantwoordelijke verklaart voor het begin van de werken dat :</p>
        <div class="rounded-sm border-2 border-[#d97a3c] p-3 space-y-2">
          <ul class="list-disc pl-5 space-y-1">
            <li>hij volledig is ingelicht over de werkzone en over de kabels waaraan het werk moet worden verricht ;</li>
            <li>hij in geval van twijfel de werken zal stopzetten en contact zal opnemen met de schakelbevoegde van Sibelga ;</li>
            <li>
              hij alle nodige instructies zal overmaken aan de personen die werken onder zijn verantwoordelijkheid. De ploeg die het werk verricht is samengesteld uit de volgende personen:
              <textarea v-model="state.ploegLeden" :rows="2" class="wvg-input mt-1 block w-full px-2 py-1 text-sm"></textarea>
            </li>
          </ul>
        </div>
      </div>

      <div class="px-5 pb-3 flex flex-wrap items-end gap-3 text-sm" data-opgemaakt-row>
        <span class="text-neutral-700 whitespace-nowrap">Opgemaakt in 2 exemplaren te</span>
        <input v-model="state.plaats" type="text" class="wvg-input h-8 flex-1 min-w-[140px] px-2">
        <span class="text-neutral-700 whitespace-nowrap">Datum & uur</span>
        <input v-model="opgemaaktStr" type="datetime-local" class="wvg-input h-8 w-52 px-2">
      </div>

      <div class="px-5 py-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <div class="border-b border-neutral-300 pb-1 font-semibold text-neutral-800">De werkverantwoordelijke</div>
        <div class="border-b border-neutral-300 pb-1 font-semibold text-neutral-800">De schakelbevoegde van Sibelga</div>

        <label class="block"><span class="block text-xs text-neutral-600">Naam</span><input v-model="state.werkverantwoordelijkeNaam" type="text" class="wvg-input h-8 w-full px-2"></label>
        <label class="block"><span class="block text-xs text-neutral-600">Naam</span><input v-model="state.schakelbevoegdeNaam" type="text" class="wvg-input h-8 w-full px-2"></label>

        <label class="block"><span class="block text-xs text-neutral-600">Voornaam</span><input v-model="state.werkverantwoordelijkeVoornaam" type="text" class="wvg-input h-8 w-full px-2"></label>
        <label class="block"><span class="block text-xs text-neutral-600">Voornaam</span><input v-model="state.schakelbevoegdeVoornaam" type="text" class="wvg-input h-8 w-full px-2"></label>

        <label class="block"><span class="block text-xs text-neutral-600">Hoedanigheid</span><input v-model="state.werkverantwoordelijkeHoedanigheid" type="text" class="wvg-input h-8 w-full px-2"></label>
        <div aria-hidden="true"></div>

        <label class="block"><span class="block text-xs text-neutral-600">De aannemer</span><input v-model="state.werkverantwoordelijkeAannemer" type="text" class="wvg-input h-8 w-full px-2"></label>
        <div aria-hidden="true"></div>

        <div>
          <span class="block text-xs text-neutral-600">Handtekening</span>
          <SignaturePad v-model="state.werkverantwoordelijkeHandtekening" />
        </div>
        <div>
          <span class="block text-xs text-neutral-600">Handtekening</span>
          <SignaturePad v-model="state.schakelbevoegdeHandtekening" />
        </div>
      </div>

      <div data-pdf-hide>
        <div class="mx-5 mt-1 bg-[#7a3668] px-3 py-1 text-xs font-semibold text-white">
          FOTO'S
        </div>
        <div class="px-5 py-3">
          <CroutonFormRepeater
            :model-value="state.photos"
            component-name="KvrWerkvergunningensPhotoInput"
            add-label="Foto toevoegen"
            :sortable="true"
            @update:model-value="(v: any) => (state.photos = v)"
          />
        </div>
      </div>
    </div> <!-- /pdfAreaEl -->

    <div v-if="submitError || fieldErrors.length" class="mx-5 mt-2 rounded-sm border border-red-300 bg-red-50 p-3 text-sm text-red-800">
      <div v-if="submitError" class="font-semibold mb-1">{{ submitError }}</div>
      <ul v-if="fieldErrors.length" class="list-disc pl-5 space-y-0.5">
        <li v-for="(e, i) in fieldErrors" :key="i">
          <strong>{{ e.label }}:</strong> {{ e.message }}
        </li>
      </ul>
    </div>

    <div class="mt-2 flex items-center justify-end gap-3 border-t border-neutral-200 bg-neutral-50 px-5 py-4">
      <button
        type="submit"
        class="inline-flex items-center gap-2 rounded-sm bg-[#5b1f4a] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#7a3668] disabled:opacity-50"
        :disabled="submitting"
      >
        <UIcon v-if="submitting" name="i-lucide-loader-2" class="size-4 animate-spin" />
        <UIcon v-else name="i-lucide-send" class="size-4" />
        {{ submitting ? 'Versturen…' : 'Werkvergunning versturen' }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.wvg-form :deep(input[type="text"]),
.wvg-form :deep(input[type="email"]),
.wvg-form :deep(input[type="date"]),
.wvg-form :deep(input[type="datetime-local"]),
.wvg-form :deep(input[type="number"]),
.wvg-form :deep(textarea),
.wvg-input {
  background-color: #fffdf5;
  color: #111;
  border: 1px solid #d0c8b8;
  border-radius: 2px;
  outline: none;
}

.wvg-form :deep(input:focus),
.wvg-form :deep(textarea:focus),
.wvg-input:focus {
  background-color: #fff5cc;
  border-color: #5b1f4a;
}
</style>

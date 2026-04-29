const APP = 'https://secondhand-manager-xax8.vercel.app'

async function getVintedTab() {
  const tabs = await chrome.tabs.query({})
  return tabs.find(t => t.url?.match(/vinted\.(pl|com|fr|de)/)) || null
}

async function init() {
  const tab = await getVintedTab()
  const dot = document.getElementById('vdot')
  const vs = document.getElementById('vstatus')
  if (tab) { dot.classList.add('on'); vs.textContent = 'Vinted otwarty ✓' }
  else { vs.textContent = 'Otwórz vinted.pl!' }

  const s = await chrome.storage.local.get([
    'auto_repost','auto_offers','auto_import','auto_sync','offer_discount'
  ])

  // Suwak % zniżki
  const discount = s.offer_discount || 10
  const range = document.getElementById('disc-range')
  const val = document.getElementById('disc-val')
  range.value = discount
  val.textContent = discount + '%'
  range.oninput = async () => {
    val.textContent = range.value + '%'
    await chrome.storage.local.set({ offer_discount: parseInt(range.value) })
  }

  // Przełączniki
  // Auto-repost toggle z selectorem dni
  const elRepost = document.getElementById('t-repost')
  const intervalRow = document.getElementById('repost-interval-row')
  const selDays = document.getElementById('repost-days')
  if (elRepost) {
    if (s.auto_repost) elRepost.classList.add('on')
    if (intervalRow) intervalRow.style.display = s.auto_repost ? 'flex' : 'none'
    if (selDays && s.repost_days) selDays.value = s.repost_days
    elRepost.onclick = async () => {
      elRepost.classList.toggle('on')
      const on = elRepost.classList.contains('on')
      await chrome.storage.local.set({ auto_repost: on })
      if (intervalRow) intervalRow.style.display = on ? 'flex' : 'none'
      chrome.runtime.sendMessage({ type: on ? 'ALARM_START' : 'ALARM_STOP' })
    }
    selDays?.addEventListener('change', async e => {
      const days = parseInt(e.target.value)
      await chrome.storage.local.set({ repost_days: days })
      chrome.runtime.sendMessage({ type: 'ALARM_START', days })
    })
  }
  tog('t-offers', s.auto_offers, 'auto_offers')
  tog('t-import', s.auto_import, 'auto_import')
  // Auto-sync toggle z alarmem co 60 min
  const elSync = document.getElementById('t-sync')
  if (elSync) {
    if (s.auto_sync) elSync.classList.add('on')
    elSync.onclick = async () => {
      elSync.classList.toggle('on')
      const on = elSync.classList.contains('on')
      await chrome.storage.local.set({ auto_sync: on })
      chrome.runtime.sendMessage({ type: on ? 'SYNC_ALARM_START' : 'SYNC_ALARM_STOP' })
    }
  }
}

function tog(id, val, key) {
  const el = document.getElementById(id)
  if (!el) return
  if (val) el.classList.add('on')
  el.onclick = async () => {
    el.classList.toggle('on')
    await chrome.storage.local.set({ [key]: el.classList.contains('on') })
  }
}

async function send(type) {
  const tab = await getVintedTab()
  if (!tab) { alert('Otwórz vinted.pl!'); return }
  chrome.tabs.sendMessage(tab.id, { type }).catch(() => {})
  window.close()
}

document.getElementById('b-repost').onclick = () => send('TRIGGER_REPOST_SELECTED')
document.getElementById('b-offers').onclick = () => send('TRIGGER_OFFERS_ALL')
document.getElementById('b-sync').onclick   = () => send('TRIGGER_SYNC')
document.getElementById('b-app').onclick    = () => { chrome.tabs.create({ url: APP }); window.close() }

init()

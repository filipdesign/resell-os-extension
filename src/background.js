const APP_URL = 'https://secondhand-manager-xax8.vercel.app'
let capturedTokens = {}
let queueTabId = null

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'SYNC_SOLD') { syncSold(msg.items, reply); return true }
  if (msg.type === 'SALE_DETECTED') { syncSold([msg.data], () => {}); return true }
  if (msg.type === 'SAVE_TOKENS') {
    capturedTokens = { ...capturedTokens, ...msg.tokens }
    chrome.storage.local.set({ vinted_tokens: capturedTokens })
    return true
  }
  if (msg.type === 'vinted:getTokens') {
    chrome.storage.local.get('vinted_tokens', s => reply(s.vinted_tokens || capturedTokens))
    return true
  }
  if (msg.type === 'vinted:fetchArrayBuffer') {
    fetch(msg.url, { credentials: 'omit' })
      .then(r => {
        if (!r.ok) { reply({ ok: false, status: r.status }); return }
        r.arrayBuffer().then(buf => reply({ ok: true, buffer: buf, contentType: r.headers.get('content-type') || 'image/jpeg' }))
      })
      .catch(e => reply({ ok: false, error: e.message }))
    return true
  }

  // --- KOLEJKA ---
  if (msg.type === 'QUEUE_START') {
    chrome.storage.local.set({
      ros_queue: msg.ids,
      ros_queue_total: msg.ids.length,
      ros_queue_done: 0,
      ros_queue_running: true,
      ros_queue_origin: msg.origin
    }, () => processNext())
    reply({ ok: true })
    return true
  }
  if (msg.type === 'QUEUE_STOP') {
    chrome.storage.local.set({ ros_queue_running: false, ros_queue: [] })
    if (queueTabId) { chrome.tabs.remove(queueTabId).catch(() => {}); queueTabId = null }
    reply({ ok: true })
    return true
  }
  if (msg.type === 'REPOST_DONE') {
    chrome.storage.local.get(['ros_queue_done', 'ros_queue_total', 'ros_queue_running'], s => {
      if (!s.ros_queue_running) return
      const done = (s.ros_queue_done || 0) + 1
      chrome.storage.local.set({ ros_queue_done: done })
      // Zamknij obecna zakladke
      if (queueTabId) { chrome.tabs.remove(queueTabId).catch(() => {}); queueTabId = null }
      // Losowe opoznienie 20-40 sekund (bezpieczne dla Vinted)
      const delay = 20000 + Math.random() * 20000
      setTimeout(() => processNext(), delay)
    })
    return true
  }
  if (msg.type === 'OPEN_SYNC_TAB') {
    chrome.tabs.create({ url: 'https://www.vinted.pl/my_orders?order_type=sold', active: false }, tab => {
      // Po zaladowaniu strony wyslij TRIGGER_SYNC
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener)
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_SYNC' }).catch(() => {})
            // Zamknij po 5 sekundach
            setTimeout(() => chrome.tabs.remove(tab.id).catch(() => {}), 5000)
          }, 2000)
        }
      })
    })
    return true
  }
  if (msg.type === 'SYNC_ORDER') {
    const { vintedItemId, title, status, is_sold } = msg
    const SUPA_URL = 'https://xdbfweimhigftqsvahvw.supabase.co'
    const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkYmZ3ZWltaGlnZnRxc3ZhaHZ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3ODAwOTcsImV4cCI6MjA5MjM1NjA5N30.p01mbnvaT7K-ZgqNiq5ICHnGEAbnElHnOomzyeIYbUE'
    const headers = {
      'apikey': SUPA_KEY,
      'Authorization': 'Bearer ' + SUPA_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    }

    // Najpierw sprobuj matchowac po vinted_id (jesli pole istnieje)
    // Jesli nie - matchuj po tytule (ilike)
    const updateData = { status, is_sold }
    if (is_sold) updateData.sold_at = new Date().toISOString()

    let url = SUPA_URL + '/rest/v1/items?'
    if (vintedItemId) {
      url += 'vinted_id=eq.' + vintedItemId
    } else if (title) {
      // Matchuj po tytule ogloszenia (pierwsze 30 znakow)
      const titlePart = encodeURIComponent(title.slice(0, 30))
      url += 'title=ilike.*' + titlePart + '*'
    } else {
      return true
    }

    fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(updateData)
    }).then(r => {
      console.log('[ROS] SYNC_ORDER', status, is_sold, r.status)
    }).catch(e => console.error('[ROS] SYNC_ORDER error', e))

    return true
  }
  if (msg.type === 'OPEN_APP') {
    chrome.tabs.create({ url: msg.url, active: true })
    return true
  }
  if (msg.type === 'QUEUE_STATUS') {
    chrome.storage.local.get(['ros_queue', 'ros_queue_done', 'ros_queue_total', 'ros_queue_running'], s => {
      reply({ queue: s.ros_queue || [], done: s.ros_queue_done || 0, total: s.ros_queue_total || 0, running: s.ros_queue_running || false })
    })
    return true
  }

  return true
})

function processNext() {
  chrome.storage.local.get(['ros_queue', 'ros_queue_running', 'ros_queue_origin'], s => {
    if (!s.ros_queue_running || !s.ros_queue || s.ros_queue.length === 0) {
      chrome.storage.local.set({ ros_queue_running: false })
      // Powiadom wszystkie zakladki Vinted ze kolejka skonczyła
      chrome.tabs.query({ url: '*://*.vinted.pl/*' }, tabs => {
        tabs.forEach(t => chrome.tabs.sendMessage(t.id, { type: 'QUEUE_FINISHED' }).catch(() => {}))
      })
      return
    }
    const nextId = s.ros_queue[0]
    const remaining = s.ros_queue.slice(1)
    chrome.storage.local.set({ ros_queue: remaining, ros_auto_item: nextId })
    const url = (s.ros_queue_origin || 'https://www.vinted.pl') + '/items/' + nextId
    chrome.tabs.create({ url, active: false }, tab => {
      queueTabId = tab.id
    })
  })
}

async function syncSold(items, cb) {
  try {
    const s = await chrome.storage.local.get('resellos_token')
    await fetch(APP_URL + '/api/sync/vinted-sold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (s.resellos_token || '') },
      body: JSON.stringify({ items })
    })
    cb && cb({ ok: true })
  } catch { cb && cb({ ok: false }) }
}


// ---- AUTO-REPOST HARMONOGRAM ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ALARM_START') {
    chrome.storage.local.get(['repost_days'], s => {
      const days = msg.days || s.repost_days || 7
      const periodInMinutes = days * 24 * 60
      chrome.alarms.create('auto_repost', { delayInMinutes: periodInMinutes, periodInMinutes })
      console.log('[ResellOS] Alarm ustawiony co', days, 'dni')
    })
  } else if (msg.type === 'ALARM_STOP') {
    chrome.alarms.clear('auto_repost')
    console.log('[ResellOS] Alarm wylaczony')
  }
})

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== 'auto_repost') return
  console.log('[ResellOS] Alarm auto_repost - uruchamiam repost')
  const tabs = await chrome.tabs.query({ url: '*://*.vinted.pl/*' })
  if (tabs.length === 0) {
    console.log('[ResellOS] Brak otwartej zakladki Vinted - pomijam')
    return
  }
  chrome.tabs.sendMessage(tabs[0].id, { type: 'REPOST_ALL' })
})


// ---- AUTO-SYNC HARMONOGRAM (co 60 min) ----
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SYNC_ALARM_START') {
    chrome.alarms.create('auto_sync', { periodInMinutes: 60 })
    console.log('[ResellOS] Auto-sync alarm ustawiony co 60 min')
  } else if (msg.type === 'SYNC_ALARM_STOP') {
    chrome.alarms.clear('auto_sync')
    console.log('[ResellOS] Auto-sync alarm wylaczony')
  }
})

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== 'auto_sync') return
  console.log('[ResellOS] Auto-sync - uruchamiam sync zamowien')
  chrome.runtime.sendMessage({ type: 'OPEN_SYNC_TAB' })
})

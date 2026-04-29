;(function() {
'use strict'
const APP_URL = 'https://secondhand-manager-xax8.vercel.app'
const PURPLE = '#8b5cf6', GREEN = '#10b981', ORANGE = '#f59e0b', RED = '#ef4444'
const rnd = (min, max) => min + Math.random() * (max - min)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
function getCookie(name) {
  try { for (const p of document.cookie.split(';').map(s=>s.trim()).reverse()) { const eq = p.indexOf('='); if (eq>0 && decodeURIComponent(p.slice(0,eq).trim())===name) return decodeURIComponent(p.slice(eq+1)) } } catch {} return null
}
function uuidv4() { return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16)) }

async function fetchImageViaBackground(url) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'vinted:fetchArrayBuffer', url }, resp => {
      if (!resp || !resp.ok) { reject(new Error('bg fail')); return }
      resolve(new Blob([resp.buffer], { type: resp.contentType || 'image/jpeg' }))
    })
  })
}

// ---- GŁÓWNA FUNKCJA REPOSTU (przez UI + formularz) ----
async function repostSingle(itemId, autoMode=false) {
  try {
    toast('📋 Pobieram dane...', PURPLE)
    const anonId = getCookie('anon_id'), csrf = uuidv4()
    const h = { 'accept': 'application/json', 'x-csrf-token': csrf }
    if (anonId) h['x-anon-id'] = anonId
    let data = null
    try {
      const r = await fetch(`${location.origin}/api/v2/item_upload/items/${itemId}`, { credentials: 'include', headers: h })
      if (r.ok) { const j = await r.json(); data = j.item || j }
    } catch {}

    const brandLink = document.querySelector('a[href*="/brand/"],a[href*="/marki/"]')
    const brandText = brandLink?.textContent?.trim().split(' ')[0] || ''
    const bodyText = document.body.innerText
    const sizeM = bodyText.match(/Rozmiar[:\s]+([\w.]+)/)
    const condM = bodyText.match(/Stan[:\s]+([^|\n]+)/)
    const colorM = bodyText.match(/Kolor[:\s]+([^/|\n]+)/)
    const titleEl = document.querySelector('h1')

    if (!data && !titleEl) throw new Error('Nie mozna pobrac danych')

    const repostData = {
      title: data?.title || titleEl?.textContent?.trim() || '',
      description: data?.description || '',
      price: data?.price_numeric || parseFloat(data?.price?.amount || '0') || 0,
      brand: brandText || data?.brand_title || '',
      size: sizeM?.[1]?.trim() || data?.size_title || '',
      condition: condM?.[1]?.trim() || '',
      color: colorM?.[1]?.trim() || '',
      catalog_id: data?.catalog_id || null,
      catalog_title: data?.catalog_title || '',
      photos: (data?.photos || []).map(p => p.full_size_url || p.url).filter(Boolean),
      source_id: itemId
    }

    if (!autoMode) {
      const ok = confirm(`Repost: "${repostData.title}"\n\nUsunac stare ogloszenie?\n(OK = usun, Anuluj = zachowaj)`)
      if (!ok) {
        sessionStorage.setItem('ros_repost_data', JSON.stringify(repostData))
        toast('📝 Otwieram formularz...', PURPLE)
        await sleep(400)
        window.location.href = `${location.origin}/items/new`
        return
      }
    }

    sessionStorage.setItem('ros_repost_data', JSON.stringify(repostData))

    toast('🗑️ Usuwam...', ORANGE)
    try {
      const delBtn = [...document.querySelectorAll('button,a')].find(e => e.textContent.trim() === 'Usuń')
      if (delBtn) {
        delBtn.click()
        await sleep(1200)
        const confirmBtn = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'Potwierdź i usuń')
        if (confirmBtn) {
          const origPush = history.pushState.bind(history)
          history.pushState = function(...args) {
            if (args[2] && args[2].includes('/404')) {
              history.pushState = origPush
              if (autoMode) chrome.runtime.sendMessage({ type: 'REPOST_DONE' })
              window.location.href = location.origin + '/items/new'
              return
            }
            return origPush(...args)
          }
          confirmBtn.click()
          setTimeout(() => { window.location.href = location.origin + '/items/new' }, 300)
          return
        } else { toast('Brak dialogu potwierdzenia', ORANGE) }
      } else { toast('Brak przycisku Usun', ORANGE) }
    } catch(e) { toast('Blad usuwania: ' + e.message, ORANGE) }

    toast('📝 Otwieram formularz...', PURPLE)
    await sleep(400)
    window.location.href = `${location.origin}/items/new`
  } catch(e) {
    toast('❌ ' + e.message, RED)
    console.error('[ROS]', e)
    if (autoMode) chrome.runtime.sendMessage({ type: 'REPOST_DONE' })
  }
}

// ---- AUTOFILL na /items/new ----
if (location.pathname === '/items/new') {
  const raw = sessionStorage.getItem('ros_repost_data')
  if (raw) {
    setTimeout(async () => {
      try {
        const d = JSON.parse(raw)
        sessionStorage.removeItem('ros_repost_data')

        const fill = (sel, val) => {
          const el = document.querySelector(sel)
          if (!el || val === undefined || val === null || val === '') return false
          el.focus()
          const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
          const ns = Object.getOwnPropertyDescriptor(proto, 'value')
          ns?.set?.call(el, val)
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
          return true
        }

        await sleep(2500)
        fill('input[name="title"],input[placeholder*="sprzedajesz"],input[placeholder*="tytu"]', d.title)
        await sleep(300)
        fill('textarea[name="description"],textarea[placeholder*="opis"],textarea[placeholder*="wi"]', d.description)
        await sleep(300)
        fill('input[name="price"],input[type="number"][placeholder*="cen"],input[placeholder*="PLN"]', String(d.price).replace('.', ','))

        // Zdjecia
        if (d.photos && d.photos.length) {
          setTimeout(async () => {
            try {
              const fileInput = document.querySelector('input[type="file"]')
              if (!fileInput) { toast('Brak pola na zdjecia', ORANGE); return }
              const dt = new DataTransfer()
              for (let i = 0; i < Math.min(d.photos.length, 8); i++) {
                try {
                  const blob = await fetchImageViaBackground(d.photos[i])
                  dt.items.add(new File([blob], `photo_${i+1}.jpg`, { type: 'image/jpeg' }))
                  toast(`Zdjecie ${i+1}/${d.photos.length}`, GREEN)
                } catch(e2) {
                  try {
                    const r = await fetch(d.photos[i], { mode: 'cors', credentials: 'omit' })
                    if (r.ok) { const blob = await r.blob(); dt.items.add(new File([blob], `photo_${i+1}.jpg`, { type: 'image/jpeg' })); toast(`Zdjecie ${i+1}/${d.photos.length}`, GREEN) }
                  } catch(e3) {}
                }
              }
              if (dt.files.length > 0) {
                fileInput.files = dt.files
                fileInput.dispatchEvent(new Event('change', { bubbles: true }))
                toast(`✅ Wgrano ${dt.files.length} zdjec!`, GREEN)
              } else { toast('⚠️ Dodaj zdjecia recznie', ORANGE) }
            } catch(e) { toast('Blad zdjec: ' + e.message, ORANGE) }
          }, 1500)
        }

        // Kategoria
        setTimeout(async () => {
          try {
            const inp = document.querySelector('[data-testid="catalog-select-dropdown-input"]')
            if (inp) { inp.click(); await sleep(2500); const f = document.querySelector('[class*="Cell__heading"]'); if (f) { f.closest('[class*="Cell"]')?.click(); toast('✅ Kategoria', GREEN) } }
          } catch(e) {}
        }, 6000)

        // Marka
        if (d.brand) {
          setTimeout(async () => {
            try {
              const inp = document.querySelector('[data-testid="brand-select-dropdown-input"]')
              if (!inp) return
              inp.click(); await sleep(500); inp.focus()
              const ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
              ns?.set?.call(inp, d.brand)
              inp.dispatchEvent(new Event('input', { bubbles: true }))
              await sleep(2000)
              const cell = [...document.querySelectorAll('[class*="Cell__heading"]')].find(e => e.textContent.trim().toLowerCase() === d.brand.toLowerCase())
              if (cell) { cell.closest('[class*="Cell"]')?.click(); toast('✅ Marka: ' + d.brand, GREEN) }
              else { toast('⚠️ Nie znaleziono: ' + d.brand, ORANGE) }
            } catch(e) {}
          }, 9000)
        }

        // Rozmiar
        if (d.size) {
          setTimeout(async () => {
            try {
              const inp = document.querySelector('[data-testid="size-select-dropdown-input"],[data-testid*="size"]')
              if (!inp) return
              inp.click(); await sleep(2000)
              const cell = [...document.querySelectorAll('[class*="Cell__heading"]')].find(e => e.textContent.trim() === d.size)
              if (cell) { cell.closest('[class*="Cell"]')?.click(); toast('✅ Rozmiar', GREEN) }
            } catch(e) {}
          }, 12000)
        }

        // Stan
        if (d.condition) {
          setTimeout(async () => {
            try {
              const inp = document.querySelector('[data-testid="category-condition-single-list-input"]')
              if (!inp) return
              inp.click(); await sleep(2000)
              const cell = [...document.querySelectorAll('[class*="Cell__heading"]')].find(e => e.textContent.trim().includes(d.condition.trim().slice(0,10)))
              if (cell) { cell.closest('[class*="Cell"]')?.click(); toast('✅ Stan', GREEN) }
            } catch(e) {}
          }, 15000)
        }


        // Kolor
        if (d.color) {
          setTimeout(async () => {
            try {
              const inp = document.querySelector('[data-testid="color-select-dropdown-input"]')
              if (!inp) return
              inp.click(); await sleep(2000)
              const cell = [...document.querySelectorAll('[class*="Cell__heading"]')].find(e => e.textContent.trim().toLowerCase().includes(d.color.trim().toLowerCase().slice(0,5)))
              if (cell) {
                cell.closest('[class*="Cell"]')?.click()
                toast('✅ Kolor', GREEN)
                // Kliknij w biale tlo obok pola ceny - dokladnie jak uzytkownik
                setTimeout(() => {
                  const priceInp = document.querySelector('input[name="price"]')
                  if (priceInp) {
                    const rect = priceInp.getBoundingClientRect()
                    const x = rect.left - 20
                    const y = rect.top + rect.height / 2
                    const el = document.elementFromPoint(x, y) || priceInp.parentElement
                    el.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, cancelable:true, clientX:x, clientY:y }))
                    el.dispatchEvent(new MouseEvent('mouseup',   { bubbles:true, cancelable:true, clientX:x, clientY:y }))
                    el.dispatchEvent(new MouseEvent('click',     { bubbles:true, cancelable:true, clientX:x, clientY:y }))
                    toast('✅ Klik obok ceny', GREEN)
                  }
                }, 800)
              }
            } catch(e) {}
          }, 20000)
        }

        // Panel pomocniczy
        const helper = document.createElement('div')
        helper.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#1a1a2e;color:white;padding:16px;border-radius:12px;max-width:340px;font-family:-apple-system,sans-serif;font-size:12px;box-shadow:0 8px 32px rgba(0,0,0,.5);border:1px solid #8b5cf6'
        helper.innerHTML = '<div style="font-weight:700;color:#8b5cf6;margin-bottom:10px;font-size:14px">📋 ResellOS</div>'
          + (d.catalog_title ? `<div style="margin:4px 0;color:#fbbf24">📂 ${d.catalog_title}</div>` : '')
          + (d.brand ? `<div style="margin:4px 0">🏷️ ${d.brand}</div>` : '')
          + (d.size ? `<div style="margin:4px 0">📏 ${d.size}</div>` : '')
          + (d.condition ? `<div style="margin:4px 0">⭐ ${d.condition}</div>` : '')
          + (d.price ? `<div style="margin:4px 0">💰 ${d.price} PLN</div>` : '')
          + (d.photos?.length ? `<div style="margin:8px 0 4px;color:#10b981">🖼️ ${d.photos.length} zdjec</div><div style="display:flex;flex-wrap:wrap;gap:4px">${d.photos.slice(0,9).map(url=>`<a href="${url}" target="_blank"><img src="${url}" style="width:48px;height:48px;object-fit:cover;border-radius:5px;border:2px solid #8b5cf6"></a>`).join('')}</div>` : '')
          + '<button onclick="this.parentElement.remove()" style="margin-top:10px;background:#8b5cf6;border:none;color:white;padding:5px 14px;border-radius:6px;cursor:pointer;font-size:12px;width:100%">✕ Zamknij</button>'
        document.body.appendChild(helper)
        toast('✅ Formularz wypelniony!', GREEN)
        // Kliknij Opublikuj po 28s
        setTimeout(() => {
          try {
            // Kliknij tytul zeby zamknac dropdown koloru
            const titleInp = document.querySelector('input[name="title"],input[placeholder*="tytu"]')
            if (titleInp) { titleInp.click(); titleInp.focus() }
            setTimeout(() => {
              const submitBtn = [...document.querySelectorAll('button')].find(e =>
                e.textContent.trim() === 'Dodaj' || e.textContent.trim() === 'Opublikuj'
              )
              if (submitBtn) {
                submitBtn.scrollIntoView({ behavior: 'instant', block: 'center' })
                setTimeout(() => {
                  submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
                  toast('✅ Klikam Dodaj!', GREEN)
                  // Wyslij REPOST_DONE - background zamknie zakladke przez chrome.tabs.remove
                  setTimeout(() => chrome.runtime.sendMessage({ type: 'REPOST_DONE' }), 200)
                }, 1000)
              } else { toast('⚠️ Brak przycisku Dodaj', ORANGE) }
            }, 1500)
          } catch(e) {}
        }, 28000)
        // Wyslij REPOST_DONE po 35s
        chrome.storage.local.get('ros_queue_running', s => {
          if (s.ros_queue_running) setTimeout(() => chrome.runtime.sendMessage({ type: 'REPOST_DONE' }), 35000)
        })
      } catch(e) { console.error('[ROS] autofill:', e) }
    }, 2000)
  }
}

let lastUrl = ''

function injectItemPage() {
  if (document.getElementById('ros-item-btn')) return
  const titleEl = document.querySelector('h1')
  if (!titleEl) return
  const itemId = location.pathname.match(/\/items\/(\d+)/)?.[1]
  if (!itemId) return
  const wrap = document.createElement('div')
  wrap.style.cssText = 'display:flex;gap:8px;margin:8px 0;'
  const btn = document.createElement('button')
  btn.id = 'ros-item-btn'
  btn.textContent = '🔄 Odśwież ogłoszenie'
  btn.style.cssText = 'padding:10px 20px;background:#8b5cf6;color:white;border:none;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;box-shadow:0 4px 12px rgba(139,92,246,0.4);'
  btn.onclick = () => repostSingle(itemId, false)
  wrap.appendChild(btn)

  // Przycisk "Dodaj do ResellOS"
  const btnAdd = document.createElement('button')
  btnAdd.id = 'ros-add-btn'
  btnAdd.textContent = '📦 Dodaj do ResellOS'
  btnAdd.style.cssText = 'padding:10px 20px;background:#10b981;color:white;border:none;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;box-shadow:0 4px 12px rgba(16,185,129,0.4);'
  btnAdd.onclick = () => {
    // Zbierz dane ogloszenia z DOM
    const title = document.querySelector('h1,[class*="title"]')?.textContent?.trim() || ''
    const price = document.querySelector('[class*="price-tag"],[class*="ItemPrice"]')?.textContent?.replace(/[^0-9,\.]/g,'').replace(',','.') || ''
    // Marka - znajdz link w rzedzie Marka
    let brand = ''
    const markaRow = [...document.querySelectorAll('.details-list__item')]
      .find(row => row.querySelector('.details-list__item-value')?.textContent?.trim() === 'Marka')
    if (markaRow) {
      brand = markaRow.querySelector('a')?.textContent?.trim() || ''
    }
    const size = [...document.querySelectorAll('[class*="details"] [class*="value"],[class*="ItemAttribute"]')]
      .find(e => e.previousElementSibling?.textContent?.includes('Rozmiar'))?.textContent?.trim() || ''
    const photo = document.querySelector('[class*="ItemPhoto"] img,[class*="photo"] img')?.src || ''
    const params = new URLSearchParams({ add: '1', title, price, brand, size, photo, vinted_id: itemId, item_title: title })
    chrome.runtime.sendMessage({ type: 'OPEN_APP', url: 'https://secondhand-manager-xax8.vercel.app/?' + params.toString() })
  }
  wrap.appendChild(btnAdd)
  titleEl.parentNode.insertBefore(wrap, titleEl.nextSibling)
}

function injectCheckboxes() {
  document.querySelectorAll('[data-testid^="product-item-id-"][class*="new-item-box__container"]').forEach(card => {
    if (card.querySelector('.ros-cb-wrap')) return
    const id = card.dataset.testid?.match(/product-item-id-(\d+)/)?.[1]; if (!id) return
    const wrap = document.createElement('div'); wrap.className = 'ros-cb-wrap'
    wrap.style.cssText = 'position:absolute;top:6px;left:6px;z-index:999;background:rgba(0,0,0,0.5);border-radius:6px;padding:3px;'
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'ros-item-cb'
    cb.dataset.id = id
    cb.style.cssText = 'width:18px;height:18px;cursor:pointer;accent-color:#8b5cf6;'
    cb.onclick = e => e.stopPropagation()
    wrap.appendChild(cb)
    card.style.position = 'relative'
    card.appendChild(wrap)
  })
}

function injectWardrobePanel() {
  if (document.getElementById('ros-panel')) return
  const panel = document.createElement('div')
  panel.id = 'ros-panel'
  panel.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#1e1b4b;border-radius:16px;padding:12px;box-shadow:0 8px 32px rgba(0,0,0,0.4);width:180px;'
  const hdr = document.createElement('div')
  hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;'
  const ttl = document.createElement('span')
  ttl.style.cssText = 'color:white;font-weight:700;font-size:14px;'
  ttl.textContent = 'ResellOS'
  const cls = document.createElement('button')
  cls.style.cssText = 'background:none;border:none;color:#9ca3af;cursor:pointer;font-size:16px;'
  cls.textContent = '×'
  hdr.appendChild(ttl); hdr.appendChild(cls)
  const msg = document.createElement('div')
  msg.id = 'ros-msg'
  msg.style.cssText = 'color:#9ca3af;font-size:11px;margin-bottom:8px;min-height:14px;'
  panel.appendChild(hdr); panel.appendChild(msg)
  const b1 = mkBtn('Odswierz zaznaczone', '#8b5cf6', () => {})
  const b2 = mkBtn('Zaznacz wszystkie', '#7c3aed', () => {})
  const b3 = mkBtn('Sync statusow', '#10b981', () => {})
  const b4 = mkBtn('Otworz ResellOS', '#374151', () => {})
  panel.appendChild(b1); panel.appendChild(b2); panel.appendChild(b3); panel.appendChild(b4)
  document.body.appendChild(panel)
  cls.onclick = () => panel.style.display = 'none'
  b2.onclick = () => {
    injectCheckboxes()
    const all = document.querySelectorAll('.ros-item-cb')
    const any = [...all].some(c => !c.checked)
    all.forEach(c => c.checked = any)
  }
  b1.onclick = () => {
    injectCheckboxes()
    const checked = [...document.querySelectorAll('.ros-item-cb:checked')]
    if (!checked.length) { toast('Zaznacz ogloszenia', ORANGE); return }
    const ids = checked.map(cb => cb.dataset.id).filter(Boolean)
    if (!confirm('Odswiezenie ' + ids.length + ' ogloszen automatycznie?\nOk. ' + Math.ceil(ids.length * 0.5) + ' minut.')) return
    chrome.runtime.sendMessage({ type: 'QUEUE_START', ids, origin: location.origin }, () => {
      toast('Kolejka: ' + ids.length + ' ogloszen', PURPLE)
      updateQueueMsg()
    })
  }
  b3.onclick = syncStatuses
  b4.onclick = () => window.open(APP_URL, '_blank')
  setTimeout(injectCheckboxes, 2000)
}

function updateQueueMsg() {
  chrome.runtime.sendMessage({ type: 'QUEUE_STATUS' }, s => {
    const msg = document.getElementById('ros-msg')
    if (!msg || !s) return
    if (s.running) {
      msg.textContent = s.done + '/' + s.total + ' gotowe'
      msg.style.color = '#10b981'
      setTimeout(updateQueueMsg, 3000)
    } else if (s.total > 0) {
      msg.textContent = 'Gotowe! ' + s.done + '/' + s.total
      msg.style.color = '#10b981'
    }
  })
}


async function syncVintedOrders() {
  const SUPABASE_URL = 'https://YOUR_SUPABASE.supabase.co'
  const toast = (msg, color) => {
    const el = document.getElementById('ros-toast')
    if (el) { el.textContent = msg; el.style.background = color; el.style.opacity = '1'; setTimeout(() => { el.style.opacity = '0' }, 4000) }
    console.log('[ROS sync]', msg)
  }

  try {
    toast('🔁 Scrapuję zamówienia...', '#8b5cf6')

    // Kliknij "Wszystkie" jesli nie jest aktywne
    const allTab = [...document.querySelectorAll('button,a,[role="tab"]')]
      .find(e => e.textContent?.trim() === 'Wszystkie')
    if (allTab) { allTab.click(); await new Promise(r => setTimeout(r, 1500)) }

    // Scrape listy zamowien - szukaj linkow do inbox
    const orders = []
    const inboxLinks = [...document.querySelectorAll('a[href*="/inbox/"]')]
    
    inboxLinks.forEach(link => {
      const inboxId = link.href.match(/\/inbox\/(\d+)/)?.[1]
      const container = link.closest('li,article,[class*="Order"],[class*="order"],[class*="Cell"],[class*="cell"]') || link.parentElement
      const fullText = container?.textContent?.trim() || link.textContent?.trim() || ''
      // Wyciagnij tytul (po statusie)
      const titleMatch = fullText.match(/(?:Zakończone|W toku|Anulowane|Doręczone)(.+?)(?:\d+,\d+|$)/s)
      const title = titleMatch?.[1]?.trim()?.slice(0, 80) || fullText.slice(0, 80)
      const statusText = fullText.slice(0, 100)
      orders.push({ inboxId, title, statusText })
    })

    if (!orders.length) {
      toast('⚠️ Brak zamówień do syncu (otwórz /my_orders)', '#f59e0b')
      return
    }

    // Mapuj statusy Vinted -> Supabase
    const mapStatus = (text) => {
      const t = text.toLowerCase()
      if (t.includes('zakończone pomyślnie') || t.includes('przyjęła przedmiot') || t.includes('sprzedaż zakończona')) return { status: 'sold', is_sold: true }
      if (t.includes('doręczone') || t.includes('dostarczono')) return { status: 'sold', is_sold: true }
      if (t.includes('zwrot') || t.includes('zwrócono')) return { status: 'zwrocony', is_sold: false }
      if (t.includes('w toku') || t.includes('oczekuje') || t.includes('opłacone')) return { status: 'zarezerwowany', is_sold: false }
      if (t.includes('zarezerwowany')) return { status: 'zarezerwowany', is_sold: false }
      if (t.includes('wysłane') || t.includes('w drodze') || t.includes('doręczenie')) return { status: 'w-drodze', is_sold: false }
      if (t.includes('anulowane') || t.includes('anulowano')) return { status: 'vinted', is_sold: false }
      return null
    }

    // Wyslij do background.js zeby zaktualizowal Supabase
    let updated = 0
    for (const order of orders) {
      const mapped = mapStatus(order.statusText)
      if (!mapped) continue
      chrome.runtime.sendMessage({
        type: 'SYNC_ORDER',
        vintedItemId: order.vintedItemId,
        title: order.title,
        status: mapped.status,
        is_sold: mapped.is_sold
      })
      updated++
    }

    toast(`✅ Sync: ${updated} zamówień wysłanych do aktualizacji`, '#10b981')
  } catch(e) {
    console.error('[ROS sync error]', e)
    toast('⚠️ Błąd syncu: ' + e.message, '#f59e0b')
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'TRIGGER_SYNC') {
    if (!location.href.includes('/my_orders')) {
      // Otworz strone zamowien w nowej zakladce i sync tam
      chrome.runtime.sendMessage({ type: 'OPEN_SYNC_TAB' })
    } else {
      syncVintedOrders()
    }
    return true
  }
  if (msg.type === 'TRIGGER_OFFERS_ALL') {
    sendOffersToLikers()
    return true
  }
  if (msg.type === 'QUEUE_FINISHED') {
    toast('✅ Kolejka zakonczona!', GREEN)
    const el = document.getElementById('ros-msg')
    if (el) { el.textContent = 'Wszystkie odswiezone!'; el.style.color = '#10b981' }
  }
})

async function syncStatuses() {
  const msg = document.getElementById('ros-msg')
  if (msg) msg.textContent = 'Pobieram...'
  try {
    const r = await fetch('/api/v2/items?status[]=sold&per_page=50', { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
    if (r.ok) {
      const d = await r.json()
      const sold = (d.items || []).map(i => ({ vinted_id: String(i.id), title: i.title, price: i.price?.amount, sold_at: i.updated_at, status: 'sold' }))
      chrome.runtime.sendMessage({ type: 'SYNC_SOLD', items: sold }, () => {
        if (msg) { msg.textContent = sold.length + ' sprzedanych'; setTimeout(() => msg.textContent = '', 5000) }
      })
    }
  } catch(e) { if (msg) msg.textContent = 'Blad' }
}

function mkBtn(text, color, onClick) {
  const b = document.createElement('button')
  b.textContent = text
  b.style.cssText = 'padding:5px 8px;background:' + color + ';color:white;border:none;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;font-family:-apple-system,sans-serif;margin-top:3px;width:100%;'
  b.onclick = () => onClick(b)
  return b
}

function toast(text, color) {
  if (!color) color = '#8b5cf6'
  const t = document.createElement('div')
  t.style.cssText = 'position:fixed;top:20px;right:20px;z-index:2147483647;background:' + color + ';color:white;padding:13px 18px;border-radius:12px;font-family:-apple-system,sans-serif;font-weight:600;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.25);'
  t.textContent = text
  document.body.appendChild(t)
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s' }, 3500)
  setTimeout(() => t.remove(), 4000)
}

function init() {
  if (location.href === lastUrl) return
  lastUrl = location.href
  const path = location.pathname
  if (path.match(/\/items\/\d+/) && !path.includes('/edit')) {
    setTimeout(injectItemPage, rnd(1200, 2500))
    const itemId = path.match(/\/items\/(\d+)/)?.[1]
    if (itemId) {
      chrome.storage.local.get('ros_auto_item', s => {
        if (s.ros_auto_item === itemId) {
          chrome.storage.local.remove('ros_auto_item')
          setTimeout(() => repostSingle(itemId, true), rnd(2000, 3500))
        }
      })
    }
  }
  if (path.match(/\/my\/items|\/closet|\/wardrobe|\/member\//)) setTimeout(injectWardrobePanel, rnd(1500, 3000))
}

init()
const obs = new MutationObserver(() => init())
obs.observe(document.body, { childList: true, subtree: true })
})()


async function sendOffersToLikers() {
  const GREEN = '#10b981', ORANGE = '#f59e0b', PURPLE = '#8b5cf6'
  const toast = (msg, color) => {
    const el = document.getElementById('ros-toast')
    if (el) { el.textContent = msg; el.style.background = color; el.style.opacity = '1'; setTimeout(() => { el.style.opacity = '0' }, 3000) }
    else console.log('[ROS]', msg)
  }
  try {
    toast('💌 Pobieram ogłoszenia...', PURPLE)
    const csrf = Math.random().toString(36).slice(2)
    const h = { 'accept': 'application/json', 'x-csrf-token': csrf }

    // Pobierz ID uzytkownika z URL (np. /member/3145486656)
    const userIdMatch = location.href.match(/\/member\/(\d+)/)
    if (!userIdMatch) { toast('⚠️ Przejdź na swój profil Vinted!', ORANGE); return }
    const userId = userIdMatch[1]

    // Scrape tylko AKTYWNYCH ogloszen z DOM (pomijamy sprzedane i wersje robocze)
    const cards = [...document.querySelectorAll('a[href*="/items/"]')]
    const seen = new Set()
    const items = []
    for (const a of cards) {
      const idMatch = a.href.match(/\/items\/(\d+)/)
      if (!idMatch || seen.has(idMatch[1])) continue
      // Sprawdz czy karta ma etykiete "Sprzedane" lub "Wersja robocza"
      const card = a.closest('[class*="ItemBox"],[class*="item-box"],[class*="Card"]') || a
      const label = card.textContent || ''
      if (label.includes('Sprzedane') || label.includes('Wersja robocza') || label.includes('Sold') || label.includes('Draft')) continue
      seen.add(idMatch[1])
      // Wyciagnij cene z karty
      const priceEl = card.querySelector('[class*="price"],[class*="Price"]')
      const priceText = priceEl?.textContent?.replace(/[^0-9,\.]/g,'').replace(',','.') || '0'
      const price = parseFloat(priceText) || 0
      items.push({ id: idMatch[1], price })
    }
    if (!items.length) { toast('⚠️ Brak aktywnych ogłoszeń na stronie', ORANGE); return }

    // Pobierz ustawiony % znizki
    const s = await chrome.storage.local.get('offer_discount')
    const discountPct = s.offer_discount || 10

    toast(`💌 Wysyłam oferty (${discountPct}% zniżki) do ${items.length} ogłoszeń...`, GREEN)

    let sent = 0, errors = 0
    for (const item of items) {
      try {
        // Oblicz cene po znizce (min 0.50)
        const origPrice = parseFloat(item.price || 0)
        const discountedPrice = origPrice > 0
          ? Math.max(0.5, +(origPrice * (1 - discountPct / 100)).toFixed(2))
          : null

        const body = discountedPrice ? { price: discountedPrice } : {}
        const offerR = await fetch(`${location.origin}/api/v2/items/${item.id}/offer`, {
          method: 'POST',
          credentials: 'include',
          headers: { ...h, 'content-type': 'application/json' },
          body: JSON.stringify(body)
        })

        if (offerR.ok) { sent++ } else { errors++ }

        // Czekaj 2-4s miedzy ofertami
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000))
      } catch(e) { errors++ }
    }

    toast(`✅ Oferty wysłane: ${sent} OK, ${errors} błędów`, sent > 0 ? GREEN : ORANGE)
  } catch(e) {
    toast('⚠️ Błąd: ' + e.message, ORANGE)
  }
}

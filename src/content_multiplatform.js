;(function() {
  const params = new URLSearchParams(location.search)
  const title = params.get('ros_title')
  const desc = params.get('ros_desc')
  const price = params.get('ros_price')

  if (!title && !desc && !price) return

  // Wyczysc URL params
  window.history.replaceState({}, '', location.pathname)

  function fillInput(el, value) {
    if (!el) return false
    el.focus()
    try {
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')
      if (setter && setter.set) setter.set.call(el, value)
      else el.value = value
    } catch(e) { el.value = value }
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }

  function tryFill() {
    const host = location.hostname
    let filled = 0

    if (host.includes('allegro.pl')) {
      // Allegro - formularz wystawiania
      const titleEl = document.querySelector(
        'input[name="title"], input[placeholder*="tytuł"], input[placeholder*="Tytuł"], input[placeholder*="nazwa"], [data-testid*="title"] input'
      )
      if (titleEl && title) { fillInput(titleEl, title); filled++ }

      const descEl = document.querySelector(
        'textarea[name="description"], textarea[placeholder*="opis"], [data-testid*="description"] textarea, .description-editor textarea, [contenteditable="true"]'
      )
      if (descEl && desc) { fillInput(descEl, desc); filled++ }

      const priceEl = document.querySelector(
        'input[name="price"], input[placeholder*="cena"], input[placeholder*="Cena"], [data-testid*="price"] input'
      )
      if (priceEl && price) { fillInput(priceEl, price); filled++ }
    }

    if (host.includes('olx.pl')) {
      // OLX - formularz wystawiania
      const titleEl = document.querySelector(
        'input[name="title"], input[placeholder*="tytuł"], input[placeholder*="Tytuł"], input[id*="title"], #title'
      )
      if (titleEl && title) { fillInput(titleEl, title); filled++ }

      const descEl = document.querySelector(
        'textarea[name="description"], textarea[placeholder*="opis"], textarea[id*="desc"], #description'
      )
      if (descEl && desc) { fillInput(descEl, desc); filled++ }

      const priceEl = document.querySelector(
        'input[name="price"], input[placeholder*="cena"], input[id*="price"], #price'
      )
      if (priceEl && price) { fillInput(priceEl, price); filled++ }
    }

    return filled
  }

  // Probuj od razu i po 1s, 2s, 4s (strony laduja asynchronicznie)
  let attempts = 0
  const interval = setInterval(() => {
    attempts++
    const filled = tryFill()
    if (filled > 0 || attempts >= 6) {
      clearInterval(interval)
      if (filled > 0) {
        const toast = document.createElement('div')
        toast.textContent = `✅ ResellOS wypełnił ${filled} pol`
        toast.style.cssText = 'position:fixed;top:20px;right:20px;background:#7c3aed;color:#fff;padding:10px 18px;border-radius:10px;font-size:14px;z-index:999999;font-family:sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.3)'
        document.body.appendChild(toast)
        setTimeout(() => toast.remove(), 3000)
      }
    }
  }, 800)
})()

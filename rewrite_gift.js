const fs = require('fs');

const content = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Gift Keepsay \u2014 Give the gift of memories</title>
  <meta name="description" content="Give someone you love a place to keep their stories. Gift a Keepsay subscription this Mother's Day." />
  <meta property="og:title" content="Gift Keepsay \u2014 Give the gift of memories" />
  <meta property="og:description" content="Give mom a place to keep her stories. Gift Keepsay this Mother's Day." />
  <meta property="og:image" content="https://www.getkeepsay.com/og-image.jpg" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <script src="https://js.stripe.com/v3/"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --green: #1B4332; --green-mid: #2D6A4F; --green-light: #E8F0EB;
      --gold: #D4A853; --cream: #FAFAF6; --warm-gray: #F5F3EE;
      --text: #1A1A1A; --text-secondary: #5C5C5C; --text-hint: #9A9A9A; --border: #E4E1D8;
    }
    html { scroll-behavior: smooth; }
    body { font-family: 'Inter', sans-serif; background: var(--cream); color: var(--text); line-height: 1.6; -webkit-font-smoothing: antialiased; }

    /* NAV */
    nav { position: fixed; top: 0; left: 0; right: 0; z-index: 100; background: rgba(250,250,246,0.92); backdrop-filter: blur(12px); border-bottom: 0.5px solid var(--border); padding: 0 24px; height: 60px; display: flex; align-items: center; justify-content: space-between; }
    .nav-logo { display: flex; align-items: center; gap: 10px; text-decoration: none; }
    .nav-logo-icon { width: 32px; height: 32px; background: var(--green); border-radius: 8px; display: flex; align-items: center; justify-content: center; }
    .nav-logo-icon img { width: 32px; height: 32px; border-radius: 8px; display: block; }
    .nav-logo-icon span { font-family: 'Lora', serif; font-size: 18px; font-weight: 600; color: #fff; }
    .nav-logo-name { font-size: 17px; font-weight: 600; color: var(--text); letter-spacing: -0.3px; }
    .nav-back { color: var(--green); font-size: 14px; font-weight: 500; text-decoration: none; }
    .nav-back:hover { text-decoration: underline; }

    /* HERO */
    .hero { padding: 100px 24px 60px; text-align: center; max-width: 680px; margin: 0 auto; }
    .hero-badge { display: inline-block; background: rgba(212,168,83,0.15); border: 1px solid rgba(212,168,83,0.4); color: var(--gold); font-size: 12px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; padding: 6px 16px; border-radius: 50px; margin-bottom: 24px; }
    .hero-title { font-family: 'Lora', Georgia, serif; font-size: clamp(32px, 5vw, 52px); font-weight: 600; line-height: 1.2; color: var(--text); margin-bottom: 16px; letter-spacing: -0.5px; }
    .hero-title em { font-style: italic; color: var(--green); }
    .hero-sub { font-size: 17px; color: var(--text-secondary); line-height: 1.7; max-width: 480px; margin: 0 auto 12px; }
    .hero-proof { font-size: 13px; color: var(--text-hint); }

    /* GIFT BUILDER */
    .gift-builder { max-width: 640px; margin: 0 auto; padding: 0 24px 80px; }

    /* STEP */
    .step { margin-bottom: 40px; }
    .step-label { font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--gold); margin-bottom: 12px; }
    .step-title { font-family: 'Lora', serif; font-size: 20px; font-weight: 600; color: var(--text); margin-bottom: 16px; }

    /* TIER CARDS */
    .tier-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
    .tier-card { border: 1.5px solid var(--border); border-radius: 16px; padding: 20px; cursor: pointer; transition: all 0.2s; background: #fff; position: relative; }
    .tier-card:hover { border-color: var(--green); background: var(--green-light); }
    .tier-card.selected { border-color: var(--green); background: var(--green-light); }
    .tier-card.selected::after { content: '\u2713'; position: absolute; top: 12px; right: 14px; font-size: 14px; font-weight: 700; color: var(--green); }
    .tier-badge { font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; padding: 3px 8px; border-radius: 20px; margin-bottom: 10px; display: inline-block; }
    .tier-badge.pro { background: var(--green-light); color: var(--green); }
    .tier-badge.legacy { background: rgba(212,168,83,0.15); color: #A07830; }
    .tier-name { font-size: 16px; font-weight: 600; color: var(--text); margin-bottom: 4px; }
    .tier-desc { font-size: 13px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 12px; }
    .tier-price { font-size: 15px; font-weight: 600; color: var(--green); }
    .tier-price-sub { font-size: 12px; color: var(--text-hint); font-weight: 400; }

    /* DURATION TOGGLE */
    .duration-toggle { display: flex; background: var(--warm-gray); border-radius: 12px; padding: 4px; gap: 4px; }
    .duration-btn { flex: 1; padding: 10px; text-align: center; border-radius: 9px; border: none; background: transparent; cursor: pointer; font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 500; color: var(--text-secondary); transition: all 0.2s; }
    .duration-btn.active { background: #fff; color: var(--green); font-weight: 600; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
    .duration-save { font-size: 11px; color: var(--gold); font-weight: 500; display: block; margin-top: 2px; }

    /* FORM */
    .form-group { margin-bottom: 16px; }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    label { display: block; font-size: 13px; font-weight: 500; color: var(--text-secondary); margin-bottom: 6px; }
    input, textarea { width: 100%; padding: 12px 16px; border: 1px solid var(--border); border-radius: 10px; font-family: 'Inter', sans-serif; font-size: 15px; color: var(--text); background: #fff; transition: border-color 0.2s; outline: none; }
    input:focus, textarea:focus { border-color: var(--green); }
    textarea { resize: vertical; min-height: 80px; }
    input::placeholder, textarea::placeholder { color: var(--text-hint); }

    /* ORDER SUMMARY */
    .order-summary { background: var(--green); border-radius: 16px; padding: 24px; margin-bottom: 20px; }
    .order-summary-title { font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.6); margin-bottom: 16px; }
    .order-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .order-label { font-size: 14px; color: rgba(255,255,255,0.8); }
    .order-value { font-size: 14px; font-weight: 600; color: #fff; }
    .order-divider { border: none; border-top: 0.5px solid rgba(255,255,255,0.2); margin: 12px 0; }
    .order-total-label { font-size: 16px; font-weight: 600; color: #fff; }
    .order-total-value { font-size: 22px; font-weight: 700; color: var(--gold); }

    /* STRIPE ELEMENT */
    .stripe-wrap { background: #fff; border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; margin-bottom: 16px; }
    #card-errors { color: #E24B4A; font-size: 13px; margin-top: 8px; min-height: 18px; }

    /* CTA BUTTON */
    .cta-btn { width: 100%; background: var(--gold); color: #1A1A1A; font-family: 'Inter', sans-serif; font-size: 17px; font-weight: 700; padding: 16px; border-radius: 50px; border: none; cursor: pointer; transition: opacity 0.2s, transform 0.1s; display: flex; align-items: center; justify-content: center; gap: 8px; }
    .cta-btn:hover { opacity: 0.92; transform: translateY(-1px); }
    .cta-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
    .cta-btn-sub { font-size: 12px; color: var(--text-hint); text-align: center; margin-top: 10px; }

    /* FEATURES LIST */
    .features { background: var(--warm-gray); border-radius: 16px; padding: 20px; margin-bottom: 24px; }
    .features-title { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 12px; }
    .feature-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .feature-row:last-child { margin-bottom: 0; }
    .feature-icon { font-size: 16px; width: 24px; flex-shrink: 0; }
    .feature-text { font-size: 13px; color: var(--text-secondary); }

    /* SUCCESS STATE */
    .success-state { display: none; text-align: center; padding: 60px 24px; max-width: 480px; margin: 0 auto; }
    .success-icon { font-size: 64px; margin-bottom: 24px; }
    .success-title { font-family: 'Lora', serif; font-size: 32px; font-weight: 600; color: var(--text); margin-bottom: 12px; }
    .success-sub { font-size: 16px; color: var(--text-secondary); line-height: 1.7; margin-bottom: 32px; }
    .success-note { font-size: 13px; color: var(--text-hint); background: var(--warm-gray); padding: 14px 18px; border-radius: 12px; }

    /* SPINNER */
    .spinner { display: inline-block; width: 18px; height: 18px; border: 2px solid rgba(26,26,26,0.3); border-top-color: #1A1A1A; border-radius: 50%; animation: spin 0.7s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* FOOTER */
    .gift-footer { text-align: center; padding: 32px 24px; border-top: 0.5px solid var(--border); }
    .gift-footer p { font-size: 13px; color: var(--text-hint); }
    .gift-footer a { color: var(--green); text-decoration: none; }

    @media (max-width: 500px) {
      .tier-grid { grid-template-columns: 1fr; }
      .form-row { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>

  <nav>
    <a href="https://www.getkeepsay.com" class="nav-logo">
      <div class="nav-logo-icon"><img src="/icon.png" alt="Keepsay" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span style="display:none">K</span></div>
      <span class="nav-logo-name">Keepsay</span>
    </a>
    <a href="https://www.getkeepsay.com" class="nav-back">\u2190 Back to site</a>
  </nav>

  <div id="main-content">
    <div class="hero">
      <div class="hero-badge">\uD83C\uDF38 Mother's Day Gift</div>
      <h1 class="hero-title">Give mom a place to keep <em>her stories</em></h1>
      <p class="hero-sub">Keepsay is where families preserve memories, share moments, and hear each other's voices \u2014 forever.</p>
      <p class="hero-proof">No app needed to give the gift. Recipient redeems with one tap.</p>
    </div>

    <div class="gift-builder">

      <!-- STEP 1: Choose tier -->
      <div class="step">
        <div class="step-label">Step 1</div>
        <div class="step-title">Choose a plan</div>

        <div class="tier-grid">
          <div class="tier-card selected" data-tier="pro" onclick="selectTier('pro')">
            <div class="tier-badge pro">Keepsay Pro</div>
            <div class="tier-name">Pro</div>
            <div class="tier-desc">Unlimited memories, voice recordings, photos, Family Circles, and time-locked memories.</div>
            <div class="tier-price" id="pro-price">$4.99 <span class="tier-price-sub">/ month</span></div>
          </div>
          <div class="tier-card" data-tier="legacy" onclick="selectTier('legacy')">
            <div class="tier-badge legacy">Keepsay Legacy</div>
            <div class="tier-name">Legacy</div>
            <div class="tier-desc">Video memories, AI writing assist, and everything in Pro. Your voice. Your face. Your stories.</div>
            <div class="tier-price" id="legacy-price">$9.99 <span class="tier-price-sub">/ month</span></div>
          </div>
        </div>

        <!-- Duration toggle -->
        <div class="duration-toggle">
          <button class="duration-btn" onclick="selectDuration('monthly')">
            Monthly
          </button>
          <button class="duration-btn active" onclick="selectDuration('annual')">
            Annual
            <span class="duration-save">Save up to 42%</span>
          </button>
        </div>
      </div>

      <!-- STEP 2: What's included -->
      <div class="step">
        <div class="features" id="features-box">
          <div class="features-title" id="features-title">What's included in Keepsay Pro</div>
          <div id="features-list">
            <div class="feature-row"><span class="feature-icon">\uD83C\uDFA4</span><span class="feature-text">Unlimited voice recordings \u2014 their voice, preserved forever</span></div>
            <div class="feature-row"><span class="feature-icon">\uD83D\uDCF8</span><span class="feature-text">Unlimited photo memories with secure cloud backup</span></div>
            <div class="feature-row"><span class="feature-icon">\uD83D\uDD12</span><span class="feature-text">Time-locked memories \u2014 sealed until the perfect moment to open</span></div>
            <div class="feature-row"><span class="feature-icon">\uD83C\uDF3F</span><span class="feature-text">Family Circles \u2014 share with the whole family at once</span></div>
            <div class="feature-row"><span class="feature-icon">\u2728</span><span class="feature-text">Thoughtful reflection prompts to help them write more</span></div>
            <div class="feature-row"><span class="feature-icon">\uD83D\uDCE6</span><span class="feature-text">Full data export \u2014 their memories are always theirs</span></div>
          </div>
        </div>
      </div>

      <!-- STEP 3: Who is the gift for -->
      <div class="step">
        <div class="step-label">Step 2</div>
        <div class="step-title">Who is this gift for?</div>
        <div class="form-row">
          <div class="form-group">
            <label>Recipient's first name *</label>
            <input type="text" id="recipient-name" placeholder="Mom" required />
          </div>
          <div class="form-group">
            <label>Recipient's email *</label>
            <input type="email" id="recipient-email" placeholder="mom@email.com" required />
          </div>
        </div>
        <div class="form-group">
          <label>Your name *</label>
          <input type="text" id="gifter-name" placeholder="Your name" required />
        </div>
        <div class="form-group">
          <label>Add a personal message (optional)</label>
          <textarea id="gift-message" placeholder="Mom, I got you this so you can finally write down all those stories I've been asking you to share for years. I love you. \u2764\uFE0F"></textarea>
        </div>
      </div>

      <!-- STEP 4: Payment -->
      <div class="step">
        <div class="step-label">Step 3</div>
        <div class="step-title">Complete your gift</div>

        <!-- Order summary -->
        <div class="order-summary">
          <div class="order-summary-title">Order summary</div>
          <div class="order-row">
            <span class="order-label" id="summary-plan">Keepsay Pro \u2014 Annual</span>
            <span class="order-value" id="summary-price">$34.99</span>
          </div>
          <div class="order-row">
            <span class="order-label">Gift for</span>
            <span class="order-value" id="summary-recipient">\u2014</span>
          </div>
          <hr class="order-divider">
          <div class="order-row">
            <span class="order-total-label">Total today</span>
            <span class="order-total-value" id="summary-total">$34.99</span>
          </div>
        </div>

        <!-- Your email for receipt -->
        <div class="form-group">
          <label>Your email (for receipt) *</label>
          <input type="email" id="gifter-email" placeholder="your@email.com" required />
        </div>

        <!-- Stripe card element -->
        <div class="form-group">
          <label>Card details</label>
          <div class="stripe-wrap">
            <div id="card-element"></div>
          </div>
          <div id="card-errors"></div>
        </div>

        <button class="cta-btn" id="pay-btn" onclick="handlePayment()">
          \uD83C\uDF81 Send this gift \u2014 <span id="btn-price">$34.99</span>
        </button>
        <p class="cta-btn-sub">Secure payment \u00B7 Recipient gets an email with their gift instantly \u00B7 No subscription for you</p>
      </div>

    </div>
  </div>

  <!-- SUCCESS STATE -->
  <div class="success-state" id="success-state">
    <div class="success-icon"><img src="/icon.png" alt="Keepsay" style="width:80px;height:80px;border-radius:18px;"></div>
    <h2 class="success-title">Gift sent!</h2>
    <p class="success-sub">We've sent <strong id="success-recipient-name">them</strong> an email with their Keepsay gift. They'll receive a link to download the app and activate their subscription with one tap.</p>
    <div class="success-note">A receipt has been sent to your email. The gift is valid for one year from today.</div>
  </div>

  <footer class="gift-footer">
    <p>Questions? Email us at <a href="mailto:hello@stubborngood.co">hello@stubborngood.co</a> \u00B7 <a href="/privacy.html">Privacy</a> \u00B7 <a href="/terms.html">Terms</a></p>
  </footer>

  <script>
    let selectedTier = 'pro';
    let selectedDuration = 'annual';

    const PRICES = {
      pro_monthly:     { amount: 499,  display: '$4.99',  label: 'Keepsay Pro \u2014 Monthly' },
      pro_annual:      { amount: 3499, display: '$34.99', label: 'Keepsay Pro \u2014 Annual' },
      legacy_monthly:  { amount: 999,  display: '$9.99',  label: 'Keepsay Legacy \u2014 Monthly' },
      legacy_annual:   { amount: 7999, display: '$79.99', label: 'Keepsay Legacy \u2014 Annual' },
    };

    const PRO_FEATURES = \`
      <div class="feature-row"><span class="feature-icon">\uD83C\uDFA4</span><span class="feature-text">Unlimited voice recordings \u2014 their voice, preserved forever</span></div>
      <div class="feature-row"><span class="feature-icon">\uD83D\uDCF8</span><span class="feature-text">Unlimited photo memories with secure cloud backup</span></div>
      <div class="feature-row"><span class="feature-icon">\uD83D\uDD12</span><span class="feature-text">Time-locked memories \u2014 sealed until the perfect moment to open</span></div>
      <div class="feature-row"><span class="feature-icon">\uD83C\uDF3F</span><span class="feature-text">Family Circles \u2014 share with the whole family at once</span></div>
      <div class="feature-row"><span class="feature-icon">\u2728</span><span class="feature-text">Thoughtful reflection prompts to help them write more</span></div>
      <div class="feature-row"><span class="feature-icon">\uD83D\uDCE6</span><span class="feature-text">Full data export \u2014 their memories are always theirs</span></div>
    \`;

    const LEGACY_FEATURES = \`
      <div class="feature-row"><span class="feature-icon">\uD83C\uDFA5</span><span class="feature-text">Video memories \u2014 record yourself telling the stories only you can tell</span></div>
      <div class="feature-row"><span class="feature-icon">\uD83E\uDD16</span><span class="feature-text">AI writing assist \u2014 find words for what is hard to express</span></div>
      <div class="feature-row"><span class="feature-icon">\uD83D\uDCBE</span><span class="feature-text">Generous video storage \u2014 5GB included, add more anytime for $1.99/mo</span></div>
      <div class="feature-row"><span class="feature-icon">\uD83C\uDFA4</span><span class="feature-text">Unlimited voice recordings \u2014 their voice, preserved forever</span></div>
      <div class="feature-row"><span class="feature-icon">\uD83D\uDCF8</span><span class="feature-text">Unlimited photo memories with secure cloud backup</span></div>
      <div class="feature-row"><span class="feature-icon">\uD83D\uDD12</span><span class="feature-text">Time-locked memories \u2014 sealed until the perfect moment to open</span></div>
      <div class="feature-row"><span class="feature-icon">\uD83C\uDF3F</span><span class="feature-text">Family Circles \u2014 share with the whole family at once</span></div>
      <div class="feature-row"><span class="feature-icon">\uD83D\uDCE6</span><span class="feature-text">Full data export \u2014 their memories are always theirs</span></div>
    \`;

    function getCurrentKey() {
      return selectedTier + '_' + selectedDuration;
    }

    function updateUI() {
      const key = getCurrentKey();
      const price = PRICES[key];

      document.getElementById('pro-price').innerHTML =
        selectedDuration === 'annual'
          ? '$34.99 <span class="tier-price-sub">/ year</span>'
          : '$4.99 <span class="tier-price-sub">/ month</span>';
      document.getElementById('legacy-price').innerHTML =
        selectedDuration === 'annual'
          ? '$79.99 <span class="tier-price-sub">/ year</span>'
          : '$9.99 <span class="tier-price-sub">/ month</span>';

      document.getElementById('summary-plan').textContent = price.label;
      document.getElementById('summary-price').textContent = price.display;
      document.getElementById('summary-total').textContent = price.display;
      document.getElementById('btn-price').textContent = price.display;

      document.getElementById('features-title').textContent =
        'What\\'s included in Keepsay ' + (selectedTier === 'pro' ? 'Pro' : 'Legacy');
      document.getElementById('features-list').innerHTML =
        selectedTier === 'pro' ? PRO_FEATURES : LEGACY_FEATURES;
    }

    function selectTier(tier) {
      selectedTier = tier;
      document.querySelectorAll('.tier-card').forEach(c => c.classList.remove('selected'));
      document.querySelector('[data-tier="' + tier + '"]').classList.add('selected');
      updateUI();
    }

    function selectDuration(duration) {
      selectedDuration = duration;
      document.querySelectorAll('.duration-btn').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');
      updateUI();
    }

    const stripe = Stripe('pk_test_51TQTulPdWkxJbIVEkQXe0M54rbbDMSQ50MkmWrVtdQRd5QT4H6d6hyxvesyuevtG0jFDAYcEeRcwtXrrWkrqhoji007NF7lAyc');
    const elements = stripe.elements();
    const cardElement = elements.create('card', {
      style: {
        base: {
          fontFamily: 'Inter, sans-serif',
          fontSize: '15px',
          color: '#1A1A1A',
          '::placeholder': { color: '#9A9A9A' },
        },
        invalid: { color: '#E24B4A' },
      },
    });

    async function handlePayment() {
      const recipientName = document.getElementById('recipient-name').value.trim();
      const recipientEmail = document.getElementById('recipient-email').value.trim();
      const gifterName = document.getElementById('gifter-name').value.trim();
      const gifterEmail = document.getElementById('gifter-email').value.trim();
      const message = document.getElementById('gift-message').value.trim();

      if (!recipientName || !recipientEmail || !gifterName || !gifterEmail) {
        document.getElementById('card-errors').textContent = 'Please fill in all required fields.';
        return;
      }

      const btn = document.getElementById('pay-btn');
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> Processing...';
      document.getElementById('card-errors').textContent = '';

      try {
        const response = await fetch('/api/create-gift-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tier: getCurrentKey(),
            recipientName,
            recipientEmail,
            gifterName,
            gifterEmail,
            message,
          }),
        });

        const { clientSecret, error: serverError } = await response.json();
        if (serverError) throw new Error(serverError);

        const { error } = await stripe.confirmCardPayment(clientSecret, {
          payment_method: { card: cardElement, billing_details: { name: gifterName, email: gifterEmail } },
        });

        if (error) throw new Error(error.message);

        document.getElementById('main-content').style.display = 'none';
        document.getElementById('success-state').style.display = 'block';
        window.scrollTo(0, 0);

      } catch (err) {
        document.getElementById('card-errors').textContent = err.message;
        btn.disabled = false;
        btn.innerHTML = '\uD83C\uDF81 Send this gift \u2014 <span id="btn-price">' + PRICES[getCurrentKey()].display + '</span>';
      }
    }

    document.addEventListener('DOMContentLoaded', function() {
      cardElement.mount('#card-element');
      cardElement.on('change', function(event) {
        document.getElementById('card-errors').textContent = event.error ? event.error.message : '';
      });

      document.getElementById('recipient-name').addEventListener('input', function() {
        const name = this.value.trim();
        document.getElementById('summary-recipient').textContent = name || '\u2014';
        document.getElementById('success-recipient-name').textContent = name || 'them';
      });

      updateUI();
    });
  </script>
</body>
</html>`;

fs.writeFileSync('C:/Users/pwdun/keepsay-web/gift.html', content, 'utf8');
console.log('gift.html rewritten successfully - ' + content.split('\n').length + ' lines');

// test_feature13_adversarial.js
// Adversarial Stress Harness for Feature 13 (Safe Event Delegation & safeClosest)

const assert = require('assert');
const path = require('path');

// We will test two phases:
// Phase 1: Pure Node environment with synthetic DOM & prototype safety nets
// Phase 2: Real Headless Chromium via Playwright executing in real browser DOM

async function runNodeSyntheticStress() {
  console.log('\n======================================================');
  console.log('--- Phase 1: Node.js Adversarial Unit & Mock Stress ---');
  console.log('======================================================\n');

  // Load ui_config
  const uiConfig = require('./src/ui/ui_config.js');
  const { safeClosest } = uiConfig;

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  function test(name, fn) {
    totalTests++;
    try {
      fn();
      passedTests++;
      console.log(`  [PASS] ${name}`);
    } catch (err) {
      failedTests++;
      console.error(`  [FAIL] ${name}`);
      console.error(`         ${err.stack || err.message}`);
    }
  }

  // Section 1: Non-Element / Boundary Targets with safeClosest
  console.log('Group 1: Boundary & Malformed Targets in safeClosest');

  test('Target is null', () => {
    assert.strictEqual(safeClosest(null, 'button'), null);
  });

  test('Target is undefined', () => {
    assert.strictEqual(safeClosest(undefined, 'button'), null);
  });

  test('Target is plain empty object {}', () => {
    assert.strictEqual(safeClosest({}, 'button'), null);
  });

  test('Target is object with arbitrary properties', () => {
    assert.strictEqual(safeClosest({ foo: 1, bar: 'baz' }, 'button'), null);
  });

  test('Target is number (0, 42, -1, NaN, Infinity)', () => {
    assert.strictEqual(safeClosest(0, 'button'), null);
    assert.strictEqual(safeClosest(42, 'button'), null);
    assert.strictEqual(safeClosest(-1, 'button'), null);
    assert.strictEqual(safeClosest(NaN, 'button'), null);
    assert.strictEqual(safeClosest(Infinity, 'button'), null);
  });

  test('Target is boolean (false, true)', () => {
    assert.strictEqual(safeClosest(false, 'button'), null);
    assert.strictEqual(safeClosest(true, 'button'), null);
  });

  test('Target is symbol', () => {
    assert.strictEqual(safeClosest(Symbol('test'), 'button'), null);
  });

  test('Target is string primitive or String object', () => {
    assert.strictEqual(safeClosest('button', 'button'), null);
    assert.strictEqual(safeClosest(new String('test'), 'button'), null);
  });

  test('Target is function / arrow function', () => {
    assert.strictEqual(safeClosest(() => {}, 'button'), null);
    assert.strictEqual(safeClosest(function() {}, 'button'), null);
  });

  test('Target is array', () => {
    assert.strictEqual(safeClosest([], 'button'), null);
    assert.strictEqual(safeClosest([1, 2, 3], 'button'), null);
  });

  // Section 2: Malformed / Throwing Target Properties
  console.log('\nGroup 2: Targets with Throwing / Poisoned Properties');

  test('Target has throwing closest property getter', () => {
    const poisonedTarget = {
      get closest() {
        throw new Error('POISONED_GETTER_ERROR');
      }
    };
    assert.strictEqual(safeClosest(poisonedTarget, 'button'), null);
  });

  test('Target has closest function that throws when called', () => {
    const throwingMethodTarget = {
      closest: () => {
        throw new Error('THROWING_METHOD_ERROR');
      }
    };
    assert.strictEqual(safeClosest(throwingMethodTarget, 'button'), null);
  });

  test('Target has throwing parentElement property getter', () => {
    const poisonedParentTarget = {
      get parentElement() {
        throw new Error('POISONED_PARENT_GETTER');
      }
    };
    assert.strictEqual(safeClosest(poisonedParentTarget, 'button'), null);
  });

  test('Target has parentElement with throwing closest method', () => {
    const poisonedParentMethod = {
      parentElement: {
        closest: () => {
          throw new Error('THROWING_PARENT_CLOSEST');
        }
      }
    };
    assert.strictEqual(safeClosest(poisonedParentMethod, 'button'), null);
  });

  test('Target has throwing parentNode property getter', () => {
    const poisonedParentNode = {
      get parentNode() {
        throw new Error('POISONED_PARENT_NODE');
      }
    };
    assert.strictEqual(safeClosest(poisonedParentNode, 'button'), null);
  });

  // Section 3: Selectors (Invalid CSS Syntax, Empty, Non-string)
  console.log('\nGroup 3: Invalid & Boundary Selectors in safeClosest');

  const validMockEl = {
    closest: (s) => (s === 'button' ? validMockEl : null)
  };

  test('Selector is empty string ""', () => {
    assert.strictEqual(safeClosest(validMockEl, ''), null);
  });

  test('Selector is null', () => {
    assert.strictEqual(safeClosest(validMockEl, null), null);
  });

  test('Selector is undefined', () => {
    assert.strictEqual(safeClosest(validMockEl, undefined), null);
  });

  test('Selector is number / boolean / object / array / symbol', () => {
    assert.strictEqual(safeClosest(validMockEl, 123), null);
    assert.strictEqual(safeClosest(validMockEl, true), null);
    assert.strictEqual(safeClosest(validMockEl, {}), null);
    assert.strictEqual(safeClosest(validMockEl, ['button']), null);
    assert.strictEqual(safeClosest(validMockEl, Symbol('sel')), null);
  });

  test('Selector is invalid CSS syntax that causes el.closest() to throw DOMException', () => {
    const domThrowingEl = {
      closest: (sel) => {
        const err = new Error(`Failed to execute 'closest' on 'Element': '${sel}' is not a valid selector.`);
        err.name = 'SyntaxError';
        err.code = 12;
        throw err;
      }
    };
    assert.strictEqual(safeClosest(domThrowingEl, '[invalid:selector'), null);
    assert.strictEqual(safeClosest(domThrowingEl, ':::broken'), null);
    assert.strictEqual(safeClosest(domThrowingEl, 'div > > span'), null);
  });

  // Section 4: Text Nodes and Comment Nodes Navigation
  console.log('\nGroup 4: Text & Comment Nodes in Mock Tree');

  const mockDiv = { tagName: 'DIV', closest: (s) => (s === 'div' ? mockDiv : null) };
  const mockBtn = { tagName: 'BUTTON', parentElement: mockDiv, closest: (s) => (s === 'button' ? mockBtn : mockDiv.closest(s)) };

  test('Text node inside button resolves to button ancestor', () => {
    const textNode = { nodeType: 3, parentElement: mockBtn };
    assert.strictEqual(safeClosest(textNode, 'button'), mockBtn);
    assert.strictEqual(safeClosest(textNode, 'div'), mockDiv);
    assert.strictEqual(safeClosest(textNode, 'section'), null);
  });

  test('Text node using parentNode fallback resolves properly', () => {
    const textNodeWithParentNode = { nodeType: 3, parentNode: mockBtn };
    assert.strictEqual(safeClosest(textNodeWithParentNode, 'button'), mockBtn);
    assert.strictEqual(safeClosest(textNodeWithParentNode, 'div'), mockDiv);
  });

  test('Comment node (nodeType 8) inside button resolves properly', () => {
    const commentNode = { nodeType: 8, parentElement: mockBtn };
    assert.strictEqual(safeClosest(commentNode, 'button'), mockBtn);
    assert.strictEqual(safeClosest(commentNode, 'div'), mockDiv);
  });

  test('Orphaned Text node without parentElement or parentNode', () => {
    const orphanedText = { nodeType: 3, parentElement: null, parentNode: null };
    assert.strictEqual(safeClosest(orphanedText, 'button'), null);
  });

  test('Orphaned Comment node without parentElement or parentNode', () => {
    const orphanedComment = { nodeType: 8, parentElement: null, parentNode: null };
    assert.strictEqual(safeClosest(orphanedComment, 'button'), null);
  });

  // Section 5: Global Prototypes Simulation in Node
  console.log('\nGroup 5: Prototype Safety Nets (Window, Document, Text)');

  test('Global Window.prototype.closest behaves safely', () => {
    class MockWindow {}
    MockWindow.prototype.closest = function() { return null; };
    const win = new MockWindow();
    assert.strictEqual(win.closest('button'), null);
    assert.strictEqual(safeClosest(win, 'button'), null);
  });

  test('Global Document.prototype.closest behaves safely', () => {
    class MockDocument {}
    MockDocument.prototype.closest = function() { return null; };
    const doc = new MockDocument();
    assert.strictEqual(doc.closest('button'), null);
    assert.strictEqual(safeClosest(doc, 'button'), null);
  });

  test('Global Text.prototype.closest behaves safely and resolves parent', () => {
    class MockText {
      constructor(parent) {
        this.parentElement = parent;
        this.nodeType = 3;
      }
    }
    MockText.prototype.closest = function(selector) {
      return (this.parentElement && typeof this.parentElement.closest === 'function')
        ? this.parentElement.closest(selector)
        : (this.parentNode && typeof this.parentNode.closest === 'function')
          ? this.parentNode.closest(selector)
          : null;
    };

    const textInBtn = new MockText(mockBtn);
    assert.strictEqual(textInBtn.closest('button'), mockBtn);
    assert.strictEqual(textInBtn.closest('div'), mockDiv);
    assert.strictEqual(textInBtn.closest('.missing'), null);

    const orphaned = new MockText(null);
    assert.strictEqual(orphaned.closest('button'), null);
  });

  console.log(`\nPhase 1 Completed: ${passedTests}/${totalTests} tests passed (${failedTests} failed).`);
  return { total: totalTests, passed: passedTests, failed: failedTests };
}

async function runBrowserAdversarialStress() {
  console.log('\n======================================================');
  console.log('--- Phase 2: Headless Chromium Browser Real Stress ---');
  console.log('======================================================\n');

  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', err => {
    pageErrors.push(err.message || String(err));
  });

  // Navigate to index.html directly via file URL
  const indexPath = 'file://' + path.resolve(__dirname, 'index.html');
  console.log('Navigating to:', indexPath);
  await page.goto(indexPath, { waitUntil: 'domcontentloaded' });

  // Run comprehensive adversarial tests directly inside the Chromium execution context
  const testResults = await page.evaluate(() => {
    const results = [];

    function record(name, pass, details = '') {
      results.push({ name, pass, details });
    }

    try {
      // 1. Check window.safeClosest availability
      record('window.safeClosest is defined as function', typeof window.safeClosest === 'function');

      // 2. Check Prototype Safety Nets
      record('Window.prototype.closest is defined', typeof Window.prototype.closest === 'function');
      record('Document.prototype.closest is defined', typeof Document.prototype.closest === 'function');
      record('Text.prototype.closest is defined', typeof Text.prototype.closest === 'function');

      // 3. Direct execution on Window and Document
      try {
        const winClosest = window.closest('button');
        record('Direct execution window.closest("button") returns null', winClosest === null);
      } catch (e) {
        record('Direct execution window.closest("button")', false, e.message);
      }

      try {
        const docClosest = document.closest('button');
        record('Direct execution document.closest("button") returns null', docClosest === null);
      } catch (e) {
        record('Direct execution document.closest("button")', false, e.message);
      }

      // 4. Test Text node direct execution inside Button, Div, Span, and SVG
      const container = document.createElement('div');
      container.id = 'adversarialTestContainer';
      container.innerHTML = `
        <div id="testDiv">
          <button id="testBtn"><span>Button <strong>Text</strong></span></button>
          <svg id="testSvg" width="100" height="100">
            <text id="testSvgText">SVG Text Content</text>
          </svg>
          <!-- Comment Node Inside Div -->
        </div>
      `;
      document.body.appendChild(container);

      const testBtn = document.getElementById('testBtn');
      const testSpan = testBtn.querySelector('span');
      const testStrong = testBtn.querySelector('strong');
      const strongTextNode = testStrong.firstChild; // "Text"
      const svgTextEl = document.getElementById('testSvgText');
      const svgTextNode = svgTextEl.firstChild;

      // Direct textNode.closest('button')
      try {
        const res = strongTextNode.closest('button');
        record('Direct strongTextNode.closest("button") finds testBtn', res === testBtn);
      } catch (e) {
        record('Direct strongTextNode.closest("button")', false, e.message);
      }

      // Direct textNode.closest('span')
      try {
        const res = strongTextNode.closest('span');
        record('Direct strongTextNode.closest("span") finds testSpan', res === testSpan);
      } catch (e) {
        record('Direct strongTextNode.closest("span")', false, e.message);
      }

      // Direct textNode.closest('div')
      try {
        const res = strongTextNode.closest('div');
        record('Direct strongTextNode.closest("div") finds testDiv', res === document.getElementById('testDiv'));
      } catch (e) {
        record('Direct strongTextNode.closest("div")', false, e.message);
      }

      // Direct svgTextNode.closest('svg')
      try {
        const res = svgTextNode.closest('svg');
        record('Direct svgTextNode.closest("svg") finds testSvg', res === document.getElementById('testSvg'));
      } catch (e) {
        record('Direct svgTextNode.closest("svg")', false, e.message);
      }

      // Orphaned text node direct .closest()
      const orphanedText = document.createTextNode('orphaned');
      try {
        const res = orphanedText.closest('button');
        record('Direct orphanedText.closest("button") returns null', res === null);
      } catch (e) {
        record('Direct orphanedText.closest("button")', false, e.message);
      }

      // 5. Test safeClosest with all adversarial inputs in real browser DOM
      record('safeClosest(window, "button") === null', window.safeClosest(window, 'button') === null);
      record('safeClosest(document, "button") === null', window.safeClosest(document, 'button') === null);
      record('safeClosest(strongTextNode, "button") === testBtn', window.safeClosest(strongTextNode, 'button') === testBtn);
      record('safeClosest(strongTextNode, "span") === testSpan', window.safeClosest(strongTextNode, 'span') === testSpan);
      record('safeClosest(strongTextNode, "#testBtn") === testBtn', window.safeClosest(strongTextNode, '#testBtn') === testBtn);
      record('safeClosest(strongTextNode, ".nonexistent") === null', window.safeClosest(strongTextNode, '.nonexistent') === null);
      record('safeClosest(svgTextNode, "svg") === testSvg', window.safeClosest(svgTextNode, 'svg') === document.getElementById('testSvg'));

      // Comment node
      const commentNode = document.createComment('test comment');
      testBtn.appendChild(commentNode);
      record('safeClosest(commentNode, "button") === testBtn', window.safeClosest(commentNode, 'button') === testBtn);

      const orphanedComment = document.createComment('orphaned comment');
      record('safeClosest(orphanedComment, "button") === null', window.safeClosest(orphanedComment, 'button') === null);

      // Primitives and weird objects
      record('safeClosest({}, "button") === null', window.safeClosest({}, 'button') === null);
      record('safeClosest(null, "button") === null', window.safeClosest(null, 'button') === null);
      record('safeClosest(undefined, "button") === null', window.safeClosest(undefined, 'button') === null);
      record('safeClosest(12345, "button") === null', window.safeClosest(12345, 'button') === null);
      record('safeClosest(false, "button") === null', window.safeClosest(false, 'button') === null);
      record('safeClosest(true, "button") === null', window.safeClosest(true, 'button') === null);
      record('safeClosest(Symbol("x"), "button") === null', window.safeClosest(Symbol('x'), 'button') === null);
      record('safeClosest("random string", "button") === null', window.safeClosest('random string', 'button') === null);

      // Throwing closest property
      const throwingObj = { closest: () => { throw new Error('attack!'); } };
      record('safeClosest(throwingObj, "button") === null', window.safeClosest(throwingObj, 'button') === null);

      const getterThrowingObj = { get closest() { throw new Error('getter attack!'); } };
      record('safeClosest(getterThrowingObj, "button") === null', window.safeClosest(getterThrowingObj, 'button') === null);

      // Invalid CSS selectors
      record('safeClosest(testBtn, "[invalid:selector") === null', window.safeClosest(testBtn, '[invalid:selector') === null);
      record('safeClosest(testBtn, "::broken-pseudo") === null', window.safeClosest(testBtn, '::broken-pseudo') === null);
      record('safeClosest(testBtn, "") === null', window.safeClosest(testBtn, '') === null);
      record('safeClosest(testBtn, null) === null', window.safeClosest(testBtn, null) === null);
      record('safeClosest(testBtn, undefined) === null', window.safeClosest(testBtn, undefined) === null);
      record('safeClosest(testBtn, 123) === null', window.safeClosest(testBtn, 123) === null);
      record('safeClosest(strongTextNode, "[invalid:selector") === null', window.safeClosest(strongTextNode, '[invalid:selector') === null);

      // 6. Test ui_viewport_search click event handler behavior
      const placeInput = document.getElementById('placeSearchInput');
      const suggestionsBox = document.getElementById('searchSuggestionsDropdown');

      if (placeInput && suggestionsBox) {
        // Show dropdown first to test closing behavior
        suggestionsBox.classList.remove('hidden');
        record('Dropdown initially visible for test', !suggestionsBox.classList.contains('hidden'));

        // Dispatch click with window target
        const clickWindowEv = new MouseEvent('click', { bubbles: true, cancelable: true });
        Object.defineProperty(clickWindowEv, 'target', { value: window, configurable: true });
        document.dispatchEvent(clickWindowEv);
        record('Click with target = window hides suggestions dropdown without error', suggestionsBox.classList.contains('hidden'));

        // Re-open dropdown and click with target = document
        suggestionsBox.classList.remove('hidden');
        const clickDocEv = new MouseEvent('click', { bubbles: true, cancelable: true });
        Object.defineProperty(clickDocEv, 'target', { value: document, configurable: true });
        document.dispatchEvent(clickDocEv);
        record('Click with target = document hides suggestions dropdown without error', suggestionsBox.classList.contains('hidden'));

        // Re-open dropdown and click with target = textNode outside input & dropdown
        suggestionsBox.classList.remove('hidden');
        const clickTextOutsideEv = new MouseEvent('click', { bubbles: true, cancelable: true });
        Object.defineProperty(clickTextOutsideEv, 'target', { value: strongTextNode, configurable: true });
        document.dispatchEvent(clickTextOutsideEv);
        record('Click with target = external textNode hides suggestions dropdown without error', suggestionsBox.classList.contains('hidden'));

        // Re-open dropdown and click with target = input or inside input
        suggestionsBox.classList.remove('hidden');
        const clickInputEv = new MouseEvent('click', { bubbles: true, cancelable: true });
        Object.defineProperty(clickInputEv, 'target', { value: placeInput, configurable: true });
        document.dispatchEvent(clickInputEv);
        record('Click with target = placeInput keeps suggestions dropdown visible', !suggestionsBox.classList.contains('hidden'));

        // Click with target = comment node
        const clickCommentEv = new MouseEvent('click', { bubbles: true, cancelable: true });
        Object.defineProperty(clickCommentEv, 'target', { value: orphanedComment, configurable: true });
        document.dispatchEvent(clickCommentEv);
        record('Click with target = commentNode handled without error', true);

        // Click with target = plain object {}
        const clickObjEv = new MouseEvent('click', { bubbles: true, cancelable: true });
        Object.defineProperty(clickObjEv, 'target', { value: {}, configurable: true });
        document.dispatchEvent(clickObjEv);
        record('Click with target = plain object {} handled without error', true);

        // Click with target = null
        const clickNullEv = new MouseEvent('click', { bubbles: true, cancelable: true });
        Object.defineProperty(clickNullEv, 'target', { value: null, configurable: true });
        document.dispatchEvent(clickNullEv);
        record('Click with target = null handled without error', true);
      } else {
        record('placeSearchInput and searchSuggestionsDropdown found in DOM', false, 'Missing elements');
      }

      // Cleanup
      container.remove();

    } catch (topLevelErr) {
      record('Browser evaluate top-level execution', false, topLevelErr.stack || topLevelErr.message);
    }

    return results;
  });

  let browserPassed = 0;
  let browserFailed = 0;
  testResults.forEach(r => {
    if (r.pass) {
      browserPassed++;
      console.log(`  [PASS] ${r.name}`);
    } else {
      browserFailed++;
      console.error(`  [FAIL] ${r.name} - ${r.details}`);
    }
  });

  // Check console / page errors for any closest / TypeError
  const closestErrors = consoleErrors.concat(pageErrors).filter(e =>
    e.includes('closest') || e.includes('TypeError') || e.includes('DOMException')
  );

  console.log('\n--- Browser Console and Page Error Audit ---');
  console.log(`Total console errors captured: ${consoleErrors.length}`);
  console.log(`Total page uncaught errors: ${pageErrors.length}`);
  console.log(`Closest/TypeError/DOMException errors: ${closestErrors.length}`);

  if (closestErrors.length > 0) {
    console.error('CRITICAL: Found closest-related runtime errors in browser:');
    closestErrors.forEach(err => console.error('  >', err));
  } else {
    console.log('Zero closest/TypeError/DOMException errors detected in browser console!');
  }

  await browser.close();

  return {
    total: testResults.length,
    passed: browserPassed,
    failed: browserFailed,
    closestErrors: closestErrors.length
  };
}

(async () => {
  try {
    const nodeRes = await runNodeSyntheticStress();
    const browserRes = await runBrowserAdversarialStress();

    console.log('\n======================================================');
    console.log('--- Overall Adversarial Stress Testing Summary ---');
    console.log('======================================================');
    console.log(`Node Synthetic Tests:    ${nodeRes.passed}/${nodeRes.total} PASSED`);
    console.log(`Browser Real DOM Tests:  ${browserRes.passed}/${browserRes.total} PASSED`);
    console.log(`Browser Closest Errors:  ${browserRes.closestErrors}`);

    const allPassed = (nodeRes.failed === 0 && browserRes.failed === 0 && browserRes.closestErrors === 0);
    console.log(`\nFinal Verdict: ${allPassed ? 'ALL TESTS PASSED (APPROVE)' : 'TESTS FAILED (REQUEST_CHANGES)'}`);
    process.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error('Unexpected harness failure:', err);
    process.exit(2);
  }
})();

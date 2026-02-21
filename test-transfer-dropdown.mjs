import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { join } from 'path';

const SCREENSHOTS_DIR = './test-screenshots';
const BASE_URL = 'http://localhost:5173';
const CREDENTIALS = { email: 'admin@local', password: 'admin123' };

async function takeScreenshot(page, name, description) {
  const filename = `${name.replace(/[^a-z0-9]/gi, '-')}.png`;
  const path = join(SCREENSHOTS_DIR, filename);
  await page.screenshot({ path, fullPage: true });
  console.log(`\n📸 ${filename} - ${description}`);
  return path;
}

async function main() {
  console.log('🚀 Testing Transfer Modal Dropdown Interaction\n');
  
  const browser = await chromium.launch({ headless: false, devtools: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
      console.log(`❌ CONSOLE ERROR: ${msg.text()}`);
    }
  });
  
  try {
    // Login
    console.log('📋 Step 1: Logging in...');
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState('networkidle');
    await page.fill('input[type="email"]', CREDENTIALS.email);
    await page.fill('input[type="password"]', CREDENTIALS.password);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    console.log('✅ Logged in\n');
    
    // Navigate to Transfers
    console.log('📋 Step 2: Navigating to /transfers...');
    await page.goto(`${BASE_URL}/transfers`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await takeScreenshot(page, 'transfer-01-page', 'Transfers page');
    
    // Click New Transfer button
    console.log('\n📋 Step 3: Clicking "New Transfer" button...');
    const newTransferBtn = page.locator('button:has-text("New Transfer")').first();
    await newTransferBtn.click();
    await page.waitForTimeout(1500);
    await takeScreenshot(page, 'transfer-02-modal-opened', 'New Transfer modal opened');
    
    // Check if modal is visible
    const modalVisible = await page.locator('[role="dialog"]').isVisible();
    console.log(`Modal visible: ${modalVisible ? 'Yes' : 'No'}`);
    
    if (!modalVisible) {
      console.log('❌ Modal not visible, aborting test');
      return;
    }
    
    console.log('\n📋 Step 4: Analyzing modal structure...');
    
    // Find PrimeVue Select components
    const selectComponents = await page.evaluate(() => {
      const modal = document.querySelector('[role="dialog"]');
      if (!modal) return [];
      
      // PrimeVue Select renders as a div with specific classes
      const selects = Array.from(modal.querySelectorAll('.p-select, [class*="p-select"]'));
      return selects.map((sel, idx) => {
        const label = sel.closest('.field')?.querySelector('label')?.textContent?.trim();
        const placeholder = sel.querySelector('.p-placeholder, [class*="placeholder"]')?.textContent?.trim();
        return {
          index: idx,
          label,
          placeholder,
          classes: Array.from(sel.classList),
          hasOptions: sel.querySelector('.p-select-option') !== null
        };
      });
    });
    
    console.log(`Found ${selectComponents.length} Select components:`);
    selectComponents.forEach((sel, i) => {
      console.log(`  ${i + 1}. Label: "${sel.label}" | Placeholder: "${sel.placeholder}"`);
    });
    
    // Find the "From Warehouse" select
    console.log('\n📋 Step 5: Looking for "From Warehouse" select...');
    const fromWarehouseSelect = page.locator('.p-select').filter({ has: page.locator('text=/From Warehouse/i') }).first();
    const fromWarehouseExists = await fromWarehouseSelect.count() > 0;
    
    if (!fromWarehouseExists) {
      // Try alternative approach - find by label
      console.log('Trying alternative selector...');
      const labels = await page.locator('[role="dialog"] label').allTextContents();
      console.log('Available labels:', labels);
      
      // Find the select that comes after "From Warehouse" label
      const fromSelect = page.locator('[role="dialog"] .field').filter({ hasText: /From Warehouse/i }).locator('.p-select').first();
      const altExists = await fromSelect.count() > 0;
      
      if (altExists) {
        console.log('✅ Found "From Warehouse" select using alternative selector');
        
        // Click to open dropdown
        console.log('\n📋 Step 6: Clicking "From Warehouse" dropdown...');
        await fromSelect.click();
        await page.waitForTimeout(1000);
        await takeScreenshot(page, 'transfer-03-dropdown-opened', 'From Warehouse dropdown opened');
        
        // Get available options
        const options = await page.locator('.p-select-overlay .p-select-option').allTextContents();
        console.log(`\nAvailable warehouse options: ${options.length}`);
        options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt}`));
        
        if (options.length > 0) {
          // Click the first option
          console.log(`\n📋 Step 7: Selecting first warehouse: "${options[0]}"`);
          await page.locator('.p-select-overlay .p-select-option').first().click();
          await page.waitForTimeout(1500);
          await takeScreenshot(page, 'transfer-04-warehouse-selected', 'After selecting From Warehouse');
          
          // Check if product search field is now enabled
          console.log('\n📋 Step 8: Checking if product search field appeared...');
          
          const searchField = await page.evaluate(() => {
            const modal = document.querySelector('[role="dialog"]');
            if (!modal) return null;
            
            // Find the search section
            const searchSection = modal.querySelector('.search-section');
            const searchInput = searchSection?.querySelector('input[type="text"]');
            
            return {
              found: !!searchInput,
              disabled: searchInput?.disabled || false,
              placeholder: searchInput?.placeholder || '',
              visible: searchInput?.offsetParent !== null,
              sectionDisabled: searchSection?.classList.contains('disabled')
            };
          });
          
          console.log('\n🔍 Product Search Field Status:');
          console.log(`  Found: ${searchField.found ? 'Yes' : 'No'}`);
          console.log(`  Disabled: ${searchField.disabled ? 'Yes' : 'No'}`);
          console.log(`  Section Disabled Class: ${searchField.sectionDisabled ? 'Yes' : 'No'}`);
          console.log(`  Visible: ${searchField.visible ? 'Yes' : 'No'}`);
          console.log(`  Placeholder: "${searchField.placeholder}"`);
          
          if (searchField.found && !searchField.disabled) {
            console.log('\n✅ Product search field is enabled and ready!');
            
            // Try typing in the search field
            console.log('\n📋 Step 9: Testing product search...');
            const searchInput = page.locator('[role="dialog"] .search-section input[type="text"]');
            await searchInput.fill('test');
            await page.waitForTimeout(1500);
            await takeScreenshot(page, 'transfer-05-product-search', 'Product search field with input');
            
            // Check if search results appeared
            const resultsVisible = await page.locator('.search-results').isVisible().catch(() => false);
            console.log(`Search results visible: ${resultsVisible ? 'Yes' : 'No'}`);
            
          } else {
            console.log('\n⚠️  Product search field is still disabled or not found');
          }
        }
      } else {
        console.log('❌ Could not find "From Warehouse" select with any selector');
      }
    }
    
    // Final summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Console Errors: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
      consoleErrors.forEach((err, i) => console.log(`  ${i + 1}. ${err}`));
    } else {
      console.log('✅ No console errors!');
    }
    
    console.log('\n✅ Test completed! Screenshots saved to test-screenshots/');
    
    await page.waitForTimeout(5000);
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await takeScreenshot(page, 'error-state', 'Error state');
  } finally {
    await browser.close();
  }
}

main().catch(console.error);

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const SCREENSHOTS_DIR = './test-screenshots';
const BASE_URL = 'http://localhost:5173';
const CREDENTIALS = {
  email: 'admin@local',
  password: 'admin123'
};

// Create screenshots directory
try {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
} catch (e) {
  // Directory already exists
}

async function captureConsoleErrors(page) {
  const errors = [];
  const warnings = [];
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    } else if (msg.type() === 'warning') {
      warnings.push(msg.text());
    }
  });
  
  page.on('pageerror', error => {
    errors.push(`Page Error: ${error.message}`);
  });
  
  return { errors, warnings };
}

async function takeScreenshot(page, name, description) {
  const filename = `${name.replace(/[^a-z0-9]/gi, '-')}.png`;
  const path = join(SCREENSHOTS_DIR, filename);
  await page.screenshot({ path, fullPage: true });
  console.log(`\n📸 Screenshot saved: ${filename}`);
  console.log(`   Description: ${description}`);
  return path;
}

async function reportScreenState(page, screenName, consoleData) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🖥️  Screen: ${screenName}`);
  console.log(`${'='.repeat(60)}`);
  
  // Get current URL
  const url = page.url();
  console.log(`📍 URL: ${url}`);
  
  // Check for visible error messages
  const errorSelectors = [
    '.error',
    '.alert-error',
    '[role="alert"]',
    '.text-red-500',
    '.text-red-600',
    '.text-danger'
  ];
  
  let visibleErrors = [];
  for (const selector of errorSelectors) {
    try {
      const elements = await page.locator(selector).all();
      for (const el of elements) {
        const isVisible = await el.isVisible();
        if (isVisible) {
          const text = await el.textContent();
          if (text && text.trim()) {
            visibleErrors.push(text.trim());
          }
        }
      }
    } catch (e) {
      // Selector not found, continue
    }
  }
  
  if (visibleErrors.length > 0) {
    console.log(`\n❌ Visible Error Messages:`);
    visibleErrors.forEach(err => console.log(`   - ${err}`));
  } else {
    console.log(`\n✅ No visible error messages`);
  }
  
  // Report console errors
  if (consoleData.errors.length > 0) {
    console.log(`\n⚠️  Console Errors (${consoleData.errors.length}):`);
    consoleData.errors.forEach(err => console.log(`   - ${err}`));
  } else {
    console.log(`\n✅ No console errors`);
  }
  
  // Report console warnings (only if there are any)
  if (consoleData.warnings.length > 0) {
    console.log(`\n⚠️  Console Warnings (${consoleData.warnings.length}):`);
    consoleData.warnings.slice(0, 5).forEach(warn => console.log(`   - ${warn}`));
    if (consoleData.warnings.length > 5) {
      console.log(`   ... and ${consoleData.warnings.length - 5} more warnings`);
    }
  }
  
  return {
    url,
    visibleErrors,
    consoleErrors: consoleData.errors,
    consoleWarnings: consoleData.warnings
  };
}

async function main() {
  console.log('🚀 Starting OB Inventory Application Test\n');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Screenshots will be saved to: ${SCREENSHOTS_DIR}\n`);
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();
  
  const consoleData = await captureConsoleErrors(page);
  const testResults = [];
  
  try {
    // Test 1: Navigate to root - should redirect to /login
    console.log('\n📋 Test 1: Navigate to root URL');
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    
    const result1 = await reportScreenState(page, 'Login Page (Initial)', consoleData);
    await takeScreenshot(page, '01-login-page', 'Initial login page after navigating to root URL');
    testResults.push({ test: 'Login Page', ...result1 });
    
    // Test 2: Login
    console.log('\n📋 Test 2: Logging in with credentials');
    
    // Fill in login form
    await page.fill('input[type="email"]', CREDENTIALS.email);
    await page.fill('input[type="password"]', CREDENTIALS.password);
    await page.click('button[type="submit"]');
    
    // Wait for navigation after login
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    const result2 = await reportScreenState(page, 'Warehouses Page (After Login)', consoleData);
    await takeScreenshot(page, '02-warehouses-page', 'Main warehouses/inventory page after successful login');
    testResults.push({ test: 'Warehouses Page', ...result2 });
    
    // Test 3: Click on a warehouse card
    console.log('\n📋 Test 3: Opening warehouse stock view');
    
    // Find and click the first warehouse card
    const warehouseCards = page.locator('[class*="warehouse"], [class*="card"]').first();
    const warehouseExists = await warehouseCards.count() > 0;
    
    if (warehouseExists) {
      await warehouseCards.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);
      
      const result3 = await reportScreenState(page, 'Warehouse Stock View', consoleData);
      await takeScreenshot(page, '03-warehouse-stock', 'Individual warehouse stock view');
      testResults.push({ test: 'Warehouse Stock View', ...result3 });
      
      // Go back to warehouses
      await page.goBack();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
    } else {
      console.log('⚠️  No warehouse cards found to click');
      testResults.push({ test: 'Warehouse Stock View', error: 'No warehouse cards found' });
    }
    
    // Test 4: Navigate to Sales
    console.log('\n📋 Test 4: Navigating to Sales page');
    await page.goto(`${BASE_URL}/sales`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    
    const result4 = await reportScreenState(page, 'Sales Page', consoleData);
    await takeScreenshot(page, '04-sales-page', 'Sales page');
    testResults.push({ test: 'Sales Page', ...result4 });
    
    // Test 5: Click "New Sale" button
    console.log('\n📋 Test 5: Opening New Sale modal');
    
    const newSaleButton = page.locator('button:has-text("New Sale"), button:has-text("Nouvelle Vente")').first();
    const newSaleExists = await newSaleButton.count() > 0;
    
    if (newSaleExists) {
      await newSaleButton.click();
      await page.waitForTimeout(1000);
      
      const result5 = await reportScreenState(page, 'New Sale Modal', consoleData);
      await takeScreenshot(page, '05-new-sale-modal', 'New Sale modal dialog');
      testResults.push({ test: 'New Sale Modal', ...result5 });
      
      // Close modal (try ESC key or close button)
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } else {
      console.log('⚠️  New Sale button not found');
      testResults.push({ test: 'New Sale Modal', error: 'New Sale button not found' });
    }
    
    // Test 6: Navigate to Transfers
    console.log('\n📋 Test 6: Navigating to Transfers page');
    await page.goto(`${BASE_URL}/transfers`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    
    const result6 = await reportScreenState(page, 'Transfers Page', consoleData);
    await takeScreenshot(page, '06-transfers-page', 'Transfers page');
    testResults.push({ test: 'Transfers Page', ...result6 });
    
    // Test 7: Click "New Transfer" button
    console.log('\n📋 Test 7: Opening New Transfer modal');
    
    const newTransferButton = page.locator('button:has-text("New Transfer"), button:has-text("Nouveau Transfert")').first();
    const newTransferExists = await newTransferButton.count() > 0;
    
    if (newTransferExists) {
      await newTransferButton.click();
      await page.waitForTimeout(1000);
      
      const result7 = await reportScreenState(page, 'New Transfer Modal', consoleData);
      await takeScreenshot(page, '07-new-transfer-modal', 'New Transfer modal dialog');
      testResults.push({ test: 'New Transfer Modal', ...result7 });
      
      // Close modal
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } else {
      console.log('⚠️  New Transfer button not found');
      testResults.push({ test: 'New Transfer Modal', error: 'New Transfer button not found' });
    }
    
    // Test 8: Navigate to Settings/Parameters
    console.log('\n📋 Test 8: Navigating to Settings/Parameters page');
    await page.goto(`${BASE_URL}/settings/parameters`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    
    const result8 = await reportScreenState(page, 'Settings Parameters Page', consoleData);
    await takeScreenshot(page, '08-settings-parameters', 'Settings Parameters page');
    testResults.push({ test: 'Settings Parameters', ...result8 });
    
    // Test 9: Navigate to Settings/WooCommerce
    console.log('\n📋 Test 9: Navigating to Settings/WooCommerce page');
    await page.goto(`${BASE_URL}/settings/woocommerce`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    
    const result9 = await reportScreenState(page, 'Settings WooCommerce Page', consoleData);
    await takeScreenshot(page, '09-settings-woocommerce', 'Settings WooCommerce page');
    testResults.push({ test: 'Settings WooCommerce', ...result9 });
    
  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    console.error(error.stack);
    await takeScreenshot(page, 'error-state', 'Error state when test failed');
  } finally {
    // Generate summary report
    console.log('\n\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY REPORT');
    console.log('='.repeat(60));
    
    let totalTests = testResults.length;
    let testsWithErrors = testResults.filter(r => 
      r.visibleErrors?.length > 0 || r.consoleErrors?.length > 0 || r.error
    ).length;
    let testsWithWarnings = testResults.filter(r => 
      r.consoleWarnings?.length > 0
    ).length;
    
    console.log(`\nTotal Tests: ${totalTests}`);
    console.log(`Tests with Errors: ${testsWithErrors}`);
    console.log(`Tests with Warnings: ${testsWithWarnings}`);
    console.log(`Tests Passed: ${totalTests - testsWithErrors}`);
    
    if (testsWithErrors > 0) {
      console.log('\n❌ Tests with Issues:');
      testResults.forEach(result => {
        if (result.visibleErrors?.length > 0 || result.consoleErrors?.length > 0 || result.error) {
          console.log(`\n  • ${result.test}`);
          if (result.error) {
            console.log(`    Error: ${result.error}`);
          }
          if (result.visibleErrors?.length > 0) {
            console.log(`    Visible Errors: ${result.visibleErrors.length}`);
          }
          if (result.consoleErrors?.length > 0) {
            console.log(`    Console Errors: ${result.consoleErrors.length}`);
          }
        }
      });
    } else {
      console.log('\n✅ All tests passed without errors!');
    }
    
    // Save detailed report to JSON
    const reportPath = join(SCREENSHOTS_DIR, 'test-report.json');
    writeFileSync(reportPath, JSON.stringify(testResults, null, 2));
    console.log(`\n📄 Detailed report saved to: ${reportPath}`);
    
    console.log('\n✅ Test completed! Check the screenshots directory for visual results.');
    
    await browser.close();
  }
}

main().catch(console.error);

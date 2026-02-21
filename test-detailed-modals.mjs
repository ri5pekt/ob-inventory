import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { join } from 'path';

const SCREENSHOTS_DIR = './test-screenshots';
const BASE_URL = 'http://localhost:5173';
const CREDENTIALS = {
  email: 'admin@local',
  password: 'admin123'
};

async function captureConsoleErrors(page) {
  const errors = [];
  const warnings = [];
  const logs = [];
  
  page.on('console', msg => {
    const text = msg.text();
    const type = msg.type();
    
    if (type === 'error') {
      errors.push({ type: 'error', text, timestamp: new Date().toISOString() });
      console.log(`\n❌ CONSOLE ERROR: ${text}`);
    } else if (type === 'warning') {
      warnings.push({ type: 'warning', text, timestamp: new Date().toISOString() });
    } else if (type === 'log') {
      logs.push({ type: 'log', text, timestamp: new Date().toISOString() });
    }
  });
  
  page.on('pageerror', error => {
    const errorText = `Page Error: ${error.message}\n${error.stack}`;
    errors.push({ type: 'pageerror', text: errorText, timestamp: new Date().toISOString() });
    console.log(`\n❌ PAGE ERROR: ${errorText}`);
  });
  
  return { errors, warnings, logs };
}

async function takeScreenshot(page, name, description) {
  const filename = `${name.replace(/[^a-z0-9]/gi, '-')}.png`;
  const path = join(SCREENSHOTS_DIR, filename);
  await page.screenshot({ path, fullPage: true });
  console.log(`\n📸 Screenshot: ${filename}`);
  console.log(`   ${description}`);
  return path;
}

async function getPageSnapshot(page) {
  // Get detailed page structure
  const snapshot = await page.evaluate(() => {
    const getElementInfo = (el) => {
      if (!el) return null;
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        classes: Array.from(el.classList),
        text: el.textContent?.trim().substring(0, 100) || '',
        visible: el.offsetParent !== null,
        rect: el.getBoundingClientRect()
      };
    };

    // Find buttons
    const buttons = Array.from(document.querySelectorAll('button')).map(btn => ({
      ...getElementInfo(btn),
      type: btn.type,
      disabled: btn.disabled
    }));

    // Find all clickable elements
    const clickables = Array.from(document.querySelectorAll('[onclick], [role="button"], .btn, .button')).map(getElementInfo);

    // Get main content area
    const mainContent = document.querySelector('main, [role="main"], .content, .main-content');
    
    return {
      url: window.location.href,
      title: document.title,
      buttons: buttons.filter(b => b.visible),
      clickables: clickables.filter(c => c && c.visible),
      mainContent: getElementInfo(mainContent),
      bodyText: document.body.innerText.substring(0, 500)
    };
  });
  
  return snapshot;
}

async function main() {
  console.log('🚀 Starting Detailed Modal Testing\n');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Screenshots: ${SCREENSHOTS_DIR}\n`);
  
  const browser = await chromium.launch({ 
    headless: false,
    devtools: true  // Open DevTools automatically
  });
  
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  
  const page = await context.newPage();
  const consoleData = await captureConsoleErrors(page);
  
  try {
    // Step 1: Login
    console.log('\n📋 Step 1: Logging in');
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState('networkidle');
    await page.fill('input[type="email"]', CREDENTIALS.email);
    await page.fill('input[type="password"]', CREDENTIALS.password);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    console.log('✅ Logged in successfully');
    
    // Step 2: Navigate to Sales page
    console.log('\n📋 Step 2: Navigating to Sales page');
    await page.goto(`${BASE_URL}/sales`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    console.log('\n🔍 Taking snapshot of Sales page...');
    const salesSnapshot = await getPageSnapshot(page);
    console.log(`\nPage URL: ${salesSnapshot.url}`);
    console.log(`Page Title: ${salesSnapshot.title}`);
    console.log(`\nVisible Buttons Found: ${salesSnapshot.buttons.length}`);
    salesSnapshot.buttons.forEach((btn, i) => {
      console.log(`  ${i + 1}. "${btn.text}" - classes: [${btn.classes.join(', ')}]`);
    });
    
    await takeScreenshot(page, 'detailed-01-sales-page', 'Sales page with all buttons visible');
    
    // Step 3: Find and click "New Sale" button
    console.log('\n📋 Step 3: Looking for "New Sale" button...');
    
    // Try multiple selectors
    const newSaleSelectors = [
      'button:has-text("New Sale")',
      'button:has-text("Nouvelle Vente")',
      'button:has-text("Create Sale")',
      'button:has-text("Add Sale")',
      '[aria-label*="New Sale"]',
      '[aria-label*="new sale" i]',
      'button[class*="new"], button[class*="create"], button[class*="add"]'
    ];
    
    let newSaleButton = null;
    let usedSelector = null;
    
    for (const selector of newSaleSelectors) {
      try {
        const btn = page.locator(selector).first();
        const count = await btn.count();
        if (count > 0) {
          const isVisible = await btn.isVisible();
          if (isVisible) {
            newSaleButton = btn;
            usedSelector = selector;
            console.log(`✅ Found button with selector: ${selector}`);
            break;
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    
    if (!newSaleButton) {
      console.log('⚠️  Could not find "New Sale" button with any selector');
      console.log('📸 Taking screenshot of current state for debugging');
      await takeScreenshot(page, 'detailed-02-no-new-sale-button', 'Sales page - New Sale button not found');
      
      // Try to find any button in the top-right area
      console.log('\n🔍 Looking for buttons in top-right area...');
      const topRightButtons = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const viewportWidth = window.innerWidth;
        return buttons
          .filter(btn => {
            const rect = btn.getBoundingClientRect();
            return rect.right > viewportWidth * 0.7 && rect.top < 200 && btn.offsetParent !== null;
          })
          .map(btn => ({
            text: btn.textContent?.trim(),
            classes: Array.from(btn.classList),
            id: btn.id,
            html: btn.outerHTML.substring(0, 200)
          }));
      });
      
      console.log('Buttons in top-right area:');
      topRightButtons.forEach((btn, i) => {
        console.log(`  ${i + 1}. "${btn.text}" - classes: [${btn.classes.join(', ')}]`);
      });
    } else {
      console.log(`\n📋 Step 4: Clicking "New Sale" button`);
      await newSaleButton.click();
      await page.waitForTimeout(1500);
      
      await takeScreenshot(page, 'detailed-03-new-sale-modal', 'New Sale modal opened');
      
      // Check if modal is visible
      const modalVisible = await page.evaluate(() => {
        const modals = document.querySelectorAll('[role="dialog"], .modal, .p-dialog, [class*="modal"]');
        return Array.from(modals).some(m => m.offsetParent !== null);
      });
      
      if (modalVisible) {
        console.log('✅ Modal is visible');
        
        // Get modal content
        const modalContent = await page.evaluate(() => {
          const modal = document.querySelector('[role="dialog"], .modal, .p-dialog, [class*="modal"]');
          if (!modal) return null;
          return {
            title: modal.querySelector('[class*="header"], [class*="title"]')?.textContent?.trim(),
            fields: Array.from(modal.querySelectorAll('input, select, textarea')).map(f => ({
              type: f.tagName.toLowerCase(),
              name: f.name || f.id,
              placeholder: f.placeholder,
              label: f.closest('label')?.textContent?.trim() || f.previousElementSibling?.textContent?.trim()
            }))
          };
        });
        
        console.log('\nModal Content:');
        console.log(`  Title: ${modalContent?.title || 'N/A'}`);
        console.log(`  Form Fields: ${modalContent?.fields?.length || 0}`);
        modalContent?.fields?.forEach((field, i) => {
          console.log(`    ${i + 1}. ${field.type} - ${field.label || field.name || field.placeholder}`);
        });
        
        // Close modal
        console.log('\n📋 Step 5: Closing modal');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1000);
      } else {
        console.log('⚠️  Modal not visible after clicking button');
      }
    }
    
    // Step 6: Navigate to Transfers page
    console.log('\n📋 Step 6: Navigating to Transfers page');
    await page.goto(`${BASE_URL}/transfers`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    console.log('\n🔍 Taking snapshot of Transfers page...');
    const transfersSnapshot = await getPageSnapshot(page);
    console.log(`\nPage URL: ${transfersSnapshot.url}`);
    console.log(`\nVisible Buttons Found: ${transfersSnapshot.buttons.length}`);
    transfersSnapshot.buttons.forEach((btn, i) => {
      console.log(`  ${i + 1}. "${btn.text}" - classes: [${btn.classes.join(', ')}]`);
    });
    
    await takeScreenshot(page, 'detailed-04-transfers-page', 'Transfers page with all buttons visible');
    
    // Step 7: Find and click "New Transfer" button
    console.log('\n📋 Step 7: Looking for "New Transfer" button...');
    
    const newTransferSelectors = [
      'button:has-text("New Transfer")',
      'button:has-text("Nouveau Transfert")',
      'button:has-text("Create Transfer")',
      'button:has-text("Add Transfer")',
      '[aria-label*="New Transfer"]',
      '[aria-label*="new transfer" i]'
    ];
    
    let newTransferButton = null;
    let usedTransferSelector = null;
    
    for (const selector of newTransferSelectors) {
      try {
        const btn = page.locator(selector).first();
        const count = await btn.count();
        if (count > 0) {
          const isVisible = await btn.isVisible();
          if (isVisible) {
            newTransferButton = btn;
            usedTransferSelector = selector;
            console.log(`✅ Found button with selector: ${selector}`);
            break;
          }
        }
      } catch (e) {
        // Continue
      }
    }
    
    if (!newTransferButton) {
      console.log('⚠️  Could not find "New Transfer" button with any selector');
      await takeScreenshot(page, 'detailed-05-no-new-transfer-button', 'Transfers page - New Transfer button not found');
      
      // Try to find any button in the top-right area
      console.log('\n🔍 Looking for buttons in top-right area...');
      const topRightButtons = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const viewportWidth = window.innerWidth;
        return buttons
          .filter(btn => {
            const rect = btn.getBoundingClientRect();
            return rect.right > viewportWidth * 0.7 && rect.top < 200 && btn.offsetParent !== null;
          })
          .map(btn => ({
            text: btn.textContent?.trim(),
            classes: Array.from(btn.classList),
            id: btn.id
          }));
      });
      
      console.log('Buttons in top-right area:');
      topRightButtons.forEach((btn, i) => {
        console.log(`  ${i + 1}. "${btn.text}" - classes: [${btn.classes.join(', ')}]`);
      });
    } else {
      console.log(`\n📋 Step 8: Clicking "New Transfer" button`);
      await newTransferButton.click();
      await page.waitForTimeout(1500);
      
      await takeScreenshot(page, 'detailed-06-new-transfer-modal', 'New Transfer modal opened');
      
      // Check if modal is visible
      const modalVisible = await page.evaluate(() => {
        const modals = document.querySelectorAll('[role="dialog"], .modal, .p-dialog, [class*="modal"]');
        return Array.from(modals).some(m => m.offsetParent !== null);
      });
      
      if (modalVisible) {
        console.log('✅ Transfer modal is visible');
        
        // Get modal content
        const modalContent = await page.evaluate(() => {
          const modal = document.querySelector('[role="dialog"], .modal, .p-dialog, [class*="modal"]');
          if (!modal) return null;
          
          const selects = Array.from(modal.querySelectorAll('select'));
          const fromWarehouseSelect = selects.find(s => 
            s.name?.toLowerCase().includes('from') || 
            s.id?.toLowerCase().includes('from') ||
            s.closest('label')?.textContent?.toLowerCase().includes('from')
          );
          
          return {
            title: modal.querySelector('[class*="header"], [class*="title"]')?.textContent?.trim(),
            selects: selects.map(s => ({
              name: s.name || s.id,
              label: s.closest('label')?.textContent?.trim() || s.previousElementSibling?.textContent?.trim(),
              options: Array.from(s.options).map(o => o.text)
            })),
            fromWarehouseFound: !!fromWarehouseSelect
          };
        });
        
        console.log('\nModal Content:');
        console.log(`  Title: ${modalContent?.title || 'N/A'}`);
        console.log(`  Dropdowns: ${modalContent?.selects?.length || 0}`);
        modalContent?.selects?.forEach((select, i) => {
          console.log(`    ${i + 1}. ${select.label || select.name} - ${select.options.length} options`);
        });
        
        // Step 9: Select from "From Warehouse" dropdown
        if (modalContent?.fromWarehouseFound) {
          console.log('\n📋 Step 9: Selecting from "From Warehouse" dropdown');
          
          // Find the "From Warehouse" select
          const fromWarehouseSelect = await page.locator('select').evaluateAll(selects => {
            return selects.findIndex(s => 
              s.name?.toLowerCase().includes('from') || 
              s.id?.toLowerCase().includes('from') ||
              s.closest('label')?.textContent?.toLowerCase().includes('from')
            );
          });
          
          if (fromWarehouseSelect >= 0) {
            const selectElement = page.locator('select').nth(fromWarehouseSelect);
            
            // Get available options
            const options = await selectElement.locator('option').allTextContents();
            console.log(`Available warehouse options: ${options.length}`);
            options.forEach((opt, i) => console.log(`  ${i}. ${opt}`));
            
            // Select the first non-empty option
            if (options.length > 1) {
              await selectElement.selectOption({ index: 1 });
              console.log(`✅ Selected option: ${options[1]}`);
              
              await page.waitForTimeout(1500);
              
              await takeScreenshot(page, 'detailed-07-after-warehouse-select', 'After selecting From Warehouse - checking for product search field');
              
              // Check if product search field appeared
              const productSearchVisible = await page.evaluate(() => {
                const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])'));
                const productSearch = inputs.find(i => 
                  i.placeholder?.toLowerCase().includes('product') ||
                  i.placeholder?.toLowerCase().includes('search') ||
                  i.name?.toLowerCase().includes('product') ||
                  i.closest('label')?.textContent?.toLowerCase().includes('product')
                );
                
                return {
                  found: !!productSearch,
                  visible: productSearch?.offsetParent !== null,
                  placeholder: productSearch?.placeholder,
                  label: productSearch?.closest('label')?.textContent?.trim()
                };
              });
              
              console.log('\n🔍 Product Search Field:');
              console.log(`  Found: ${productSearchVisible.found ? 'Yes' : 'No'}`);
              console.log(`  Visible: ${productSearchVisible.visible ? 'Yes' : 'No'}`);
              console.log(`  Placeholder: ${productSearchVisible.placeholder || 'N/A'}`);
              console.log(`  Label: ${productSearchVisible.label || 'N/A'}`);
              
              if (productSearchVisible.found && productSearchVisible.visible) {
                console.log('✅ Product search field appeared after selecting warehouse');
              } else {
                console.log('⚠️  Product search field did not appear or is not visible');
              }
            }
          }
        } else {
          console.log('⚠️  "From Warehouse" dropdown not found in modal');
        }
      } else {
        console.log('⚠️  Transfer modal not visible after clicking button');
      }
    }
    
    // Final console error summary
    console.log('\n\n' + '='.repeat(60));
    console.log('📊 CONSOLE ERRORS SUMMARY');
    console.log('='.repeat(60));
    
    if (consoleData.errors.length > 0) {
      console.log(`\n❌ Total Errors: ${consoleData.errors.length}\n`);
      consoleData.errors.forEach((err, i) => {
        console.log(`${i + 1}. [${err.timestamp}] ${err.type.toUpperCase()}`);
        console.log(`   ${err.text}\n`);
      });
    } else {
      console.log('\n✅ No console errors detected!');
    }
    
    if (consoleData.warnings.length > 0) {
      console.log(`\n⚠️  Total Warnings: ${consoleData.warnings.length}`);
      console.log('(Showing first 5)');
      consoleData.warnings.slice(0, 5).forEach((warn, i) => {
        console.log(`${i + 1}. ${warn.text.substring(0, 100)}...`);
      });
    }
    
    // Save detailed report
    const report = {
      timestamp: new Date().toISOString(),
      salesPage: salesSnapshot,
      transfersPage: transfersSnapshot,
      consoleErrors: consoleData.errors,
      consoleWarnings: consoleData.warnings.slice(0, 10)
    };
    
    const reportPath = join(SCREENSHOTS_DIR, 'detailed-test-report.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Detailed report saved to: ${reportPath}`);
    
    console.log('\n✅ Testing completed!');
    
    // Keep browser open for 5 seconds so you can see the final state
    await page.waitForTimeout(5000);
    
  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    console.error(error.stack);
    await takeScreenshot(page, 'error-state', 'Error state when test failed');
  } finally {
    await browser.close();
  }
}

main().catch(console.error);

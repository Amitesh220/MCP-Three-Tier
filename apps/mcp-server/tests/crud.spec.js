const { test, expect } = require('@playwright/test');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

test.describe('Dashboard CRUD Operations Workflow', () => {
  test('Create, search, update, and delete an item iteratively', async ({ page }) => {
    // 1. Visit Dashboard
    await page.goto(FRONTEND_URL);
    await expect(page.locator('h2')).toContainText('Dashboard');

    // 2. Open Create Modal
    await page.click('[data-testid="create-new-btn"]');
    
    // Ensure modal is open by checking for its overlay or title
    await expect(page.locator('.modal-content h2')).toContainText('Create New Item');

    // 3. Fill Form
    const testItemName = `Test Item ${Date.now()}`;
    await page.fill('input[name="name"]', testItemName);
    await page.fill('textarea[name="description"]', 'This is a test description inserted via playwright.');
    await page.selectOption('select[name="status"]', 'active');
    
    // 4. Submit Form (Modal context)
    await page.click('button:has-text("Create Item")');

    // 5. Verify Item was created in the table explicitly
    // It should disappear form closing
    await expect(page.locator('.modal-content')).not.toBeVisible();
    await expect(page.locator(`text=${testItemName}`)).toBeVisible();

    // 6. Navigate to Edit via the row button
    // Locate the row containing our item name
    const row = page.locator(`tr:has-text("${testItemName}")`);
    await row.locator('button[title="Edit Item"]').click();
    
    // Verify modal changed to Edit mode
    await expect(page.locator('.modal-content h2')).toContainText('Edit Item');

    // 8. Edit Item
    await page.fill('input[name="name"]', `${testItemName} (Updated)`);
    await page.click('button:has-text("Update Item")');

    // 9. Verify Update in the table
    await expect(page.locator('.modal-content')).not.toBeVisible();
    await expect(page.locator(`text=${testItemName} (Updated)`)).toBeVisible();

    // 10. Delete Item via row button
    const updatedRow = page.locator(`tr:has-text("${testItemName} (Updated)")`);
    
    // Handle JS confirmation dialog
    page.on('dialog', async dialog => {
      await dialog.accept();
    });
    
    await updatedRow.locator('button[title="Delete Item"]').click();

    // 11. Verify Deletion
    await page.waitForTimeout(1000); // Wait for API and render (optional Toast delay)
    await expect(page.locator(`text=${testItemName} (Updated)`)).not.toBeVisible();
  });
});

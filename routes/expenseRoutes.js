const express = require('express');
const router = express.Router();
const expenseService = require('../services/expenseService');

router.put('/:id', async (req, res) => { // Correct route path
  try {
    const expenseId = req.params.id;
    const expenseData = req.body;
    
    console.log('[Update Expense] Request received:', {
      expenseId,
      description: expenseData.description,
      amount: expenseData.amount,
      paid_by: expenseData.paid_by,
      split_type: expenseData.split_type,
      participant_count: expenseData.participants?.length
    });

    // Validate required fields
    if (!expenseData.description || !expenseData.amount || !expenseData.paid_by || !expenseData.participants) {
      console.log('[Update Expense] Validation failed: Missing required fields');
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate amount is a positive number
    if (isNaN(expenseData.amount) || expenseData.amount <= 0) {
      console.log('[Update Expense] Validation failed: Invalid amount', expenseData.amount);
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }

    // Validate at least one participant is selected
    const selectedParticipants = expenseData.participants.filter(p => p.selected);
    console.log('[Update Expense] Selected participants:', {
      count: selectedParticipants.length,
      participants: selectedParticipants.map(p => ({ id: p.id, name: p.name }))
    });
    
    if (selectedParticipants.length === 0) {
      console.log('[Update Expense] Validation failed: No participants selected');
      return res.status(400).json({ error: 'At least one participant must be selected' });
    }

    // For custom split type, validate custom amounts
    if (expenseData.split_type === 'custom') {
      // Ensure custom_amounts exists and is an object
      if (!expenseData.custom_amounts || typeof expenseData.custom_amounts !== 'object') {
        console.log('[Update Expense] Validation failed: Missing or invalid custom_amounts for custom split type');
        return res.status(400).json({ 
          error: 'Custom amounts data is missing or invalid for custom split type.' 
        });
      }

      const totalCustomAmount = selectedParticipants.reduce((sum, p) => {
        // Safely access custom amount, default to 0 if not found or invalid
        const amount = parseFloat(expenseData.custom_amounts[p.id]) || 0;
        return sum + amount;
      }, 0);
      
      console.log('[Update Expense] Custom split validation:', {
        totalCustomAmount,
        expenseAmount: expenseData.amount,
        difference: Math.abs(totalCustomAmount - expenseData.amount)
      });
      
      if (Math.abs(totalCustomAmount - expenseData.amount) > 0.01) {
        console.log('[Update Expense] Validation failed: Custom amounts do not match total');
        return res.status(400).json({ 
          error: 'Sum of custom amounts must equal the total expense amount' 
        });
      }
    }

    // For shares split type, validate shares data
    else if (expenseData.split_type === 'shares') {
      // Ensure shares exists and is an object
      if (!expenseData.shares || typeof expenseData.shares !== 'object') {
        console.log('[Update Expense] Validation failed: Missing or invalid shares data for shares split type');
        return res.status(400).json({ 
          error: 'Shares data is missing or invalid for shares split type.' 
        });
      }

      // Validate that shares are positive numbers and at least one share exists
      let totalShares = 0;
      let validShares = true;
      selectedParticipants.forEach(p => {
        const share = parseFloat(expenseData.shares[p.id]) || 0;
        if (share < 0) {
          validShares = false;
        }
        totalShares += share;
      });

      if (!validShares) {
        console.log('[Update Expense] Validation failed: Shares must be non-negative numbers');
        return res.status(400).json({ error: 'Shares must be non-negative numbers.' });
      }

      if (totalShares <= 0) {
        console.log('[Update Expense] Validation failed: Total shares must be positive');
        return res.status(400).json({ error: 'Total shares must be positive for shares split type.' });
      }
      console.log('[Update Expense] Shares split validation passed:', { totalShares });
    }

    console.log('[Update Expense] Calling expense service to update expense...');
    const result = await expenseService.updateExpense(expenseId, expenseData);
    console.log('[Update Expense] Successfully updated expense:', { expenseId, result });
    res.json(result);
  } catch (error) {
    console.error('[Update Expense] Error:', {
      message: error.message,
      stack: error.stack,
      expenseId: req.params.id
    });
    if (error.message === 'Expense not found') {
      console.log('[Update Expense] Expense not found:', req.params.id);
      res.status(404).json({ error: 'Expense not found' });
    } else {
      console.error('[Update Expense] Server error while updating expense');
      res.status(500).json({ error: 'Failed to update expense' });
    }
  }
});

module.exports = router;
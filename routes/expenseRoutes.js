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
      const totalCustomAmount = selectedParticipants.reduce((sum, p) => {
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
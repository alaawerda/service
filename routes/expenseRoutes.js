const express = require('express');
const router = express.Router();
const expenseService = require('../services/expenseService');

router.put('/:id', async (req, res) => { // Correct route path
  try {
    const expenseId = req.params.id;
    const expenseData = req.body;

    // Validate required fields
    if (!expenseData.description || !expenseData.amount || !expenseData.paid_by || !expenseData.participants) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate amount is a positive number
    if (isNaN(expenseData.amount) || expenseData.amount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }

    // Validate at least one participant is selected
    const selectedParticipants = expenseData.participants.filter(p => p.selected);
    if (selectedParticipants.length === 0) {
      return res.status(400).json({ error: 'At least one participant must be selected' });
    }

    // For custom split type, validate custom amounts
    if (expenseData.split_type === 'custom') {
      const totalCustomAmount = selectedParticipants.reduce((sum, p) => {
        const amount = parseFloat(expenseData.custom_amounts[p.id]) || 0;
        return sum + amount;
      }, 0);
      
      if (Math.abs(totalCustomAmount - expenseData.amount) > 0.01) {
        return res.status(400).json({ 
          error: 'Sum of custom amounts must equal the total expense amount' 
        });
      }
    }

    const result = await expenseService.updateExpense(expenseId, expenseData);
    res.json(result);
  } catch (error) {
    console.error('Error updating expense:', error);
    if (error.message === 'Expense not found') {
      res.status(404).json({ error: 'Expense not found' });
    } else {
      res.status(500).json({ error: 'Failed to update expense' });
    }
  }
});

module.exports = router;
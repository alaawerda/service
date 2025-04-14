const db = require('../db');

class ExpenseService {
  async updateExpense(expenseId, expenseData) {
    const { description, amount, event_id, paid_by, created_date, split_type, currency, participants } = expenseData;
    let connection;

    try {
      // Check if expense exists
      const [expense] = await db.query('SELECT id FROM expenses WHERE id = ?', [expenseId]);
      if (!expense || expense.length === 0) {
        throw new Error('Expense not found');
      }

      
      // Start transaction
      connection = await db.beginTransaction();

      // Update expense details
      await db.query(
        'UPDATE expenses SET description = ?, amount = ?,  paid_by = ?, created_date = ?, split_type = ? WHERE id = ?',
        [description, amount,  paid_by, created_date, split_type, expenseId]
      );

      // Delete existing participant shares
      await db.query('DELETE FROM expense_participants WHERE expense_id = ?', [expenseId]);

      // Calculate and insert new participant shares
      const selectedParticipants = participants.filter(p => p.selected);
      
      if (split_type === 'equal') {
        const shareAmount = amount / selectedParticipants.length;
        for (const participant of selectedParticipants) {
          await db.query(
            'INSERT INTO expense_participants (expense_id, participant_id, share_amount) VALUES (?, ?, ?)',
            [expenseId, participant.id, shareAmount]
          );
        }
      } else if (split_type === 'custom') {
        for (const participant of selectedParticipants) {
          const customAmount = expenseData.custom_amounts[participant.id] || 0;
          await db.query(
            'INSERT INTO expense_participants (expense_id, participant_id, share_amount) VALUES (?, ?, ?)',
            [expenseId, participant.id, customAmount]
          );
        }
      } else if (split_type === 'shares') {
        const totalShares = selectedParticipants.reduce((sum, p) => sum + (expenseData.shares[p.id] || 1), 0);
        for (const participant of selectedParticipants) {
          const shares = expenseData.shares[participant.id] || 1;
          const shareAmount = (amount * shares) / totalShares;
          await db.query(
            'INSERT INTO expense_participants (expense_id, participant_id, share_amount) VALUES (?, ?, ?)',
            [expenseId, participant.id, shareAmount]
          );
        }
      }

      // Commit transaction
      await db.commit(connection);
      return { success: true };

    } catch (error) {
      // Rollback in case of error
      if (connection) {
        await db.rollback(connection);
      }
      throw error;
    }
  }
}

module.exports = new ExpenseService();
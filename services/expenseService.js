const db = require('../db');

class ExpenseService {
  async updateExpense(expenseId, expenseData) {
    const { description, amount, event_id, paid_by, created_date, split_type, currency, participants } = expenseData;
    let connection;

    try {
      // Check if expense exists
      const [expenseRows] = await db.query('SELECT id FROM expenses WHERE id = ?', [expenseId]);
      if (!expenseRows || expenseRows.length === 0) {
        throw new Error('Expense not found');
      }

      // Start transaction
      connection = await db.beginTransaction();

      // Update expense details
      await db.query(
        'UPDATE expenses SET description = ?, amount = ?, paid_by = ?, created_date = ?, split_type = ? WHERE id = ?',
        [description, amount, paid_by, created_date, split_type, expenseId]
      );

      // Filtrer les participants sélectionnés et non sélectionnés
      console.log('Filtrage des participants:', {
        total: participants.length,
        participants: participants.map(p => ({ id: p.id || p.participant_id, selected: p.selected, he_participates: p.he_participates }))
      });
      const selectedParticipants = participants.filter(p => {
        const isSelected = p.selected || p.he_participates === 1;
        const hasValidId = !!(p.id || p.participant_id);
        return isSelected && hasValidId;
      });
      const notSelectedParticipants = participants.filter(p => {
        const isNotSelected = !p.selected && p.he_participates !== 1;
        const hasValidId = !!(p.id || p.participant_id);
        return isNotSelected && hasValidId;
      });
      console.log('Résultat du filtrage:', {
        selectedParticipants: selectedParticipants.map(p => ({ id: p.id || p.participant_id, selected: p.selected, he_participates: p.he_participates })),
        notSelectedParticipants: notSelectedParticipants.map(p => ({ id: p.id || p.participant_id, selected: p.selected, he_participates: p.he_participates }))
      });

      // Obtenir les IDs des participants existants
      console.log('Executing query for existing participants:', {
        sql: 'SELECT GROUP_CONCAT( distinct participant_id )  FROM expense_participants WHERE expense_id = ?',
        params: [expenseId]
      });
      const [rows] = await db.query(
        'SELECT GROUP_CONCAT( distinct participant_id ) as participant_ids FROM expense_participants WHERE expense_id = ?',
        [expenseId]
      );
      console.log('Raw existing participants data:', rows);
      // Extraire et convertir les IDs de participants de la chaîne concaténée
      const existingParticipantIds = rows.participant_ids ? rows.participant_ids.split(',') : [];
      console.log('Raw existing participants data existingParticipantIds:', existingParticipantIds);

      // Mettre à jour les participants non sélectionnés existants
      for (const participant of notSelectedParticipants) {
        const participantId = participant.id || participant.participant_id;
        console.log('Participant non sélectionné:', {
          participantId,
          exists: participantId && existingParticipantIds.includes(participantId),
          participant
        });
       
          console.log('Mise à jour du participant:', participantId, 'à he_participates=0 et share_amount=0');
          await db.query(
            'UPDATE expense_participants SET he_participates = 0, share_amount = 0 WHERE expense_id = ? AND participant_id = ?',
            [expenseId, participantId]
          );
        
      }

      // Mettre à jour les participants sélectionnés avec leur statut et montant
      if (split_type === 'equal') {
        const shareAmount = selectedParticipants.length > 0 ? amount / selectedParticipants.length : 0;
        for (const participant of selectedParticipants) {
          const participantId = participant.id || participant.participant_id;
          if (!participantId) continue;
          
          const exists = existingParticipantIds.includes(participantId);
          console.log('Vérification du participant:', {
            participantId,
            exists,
            existingParticipantIds,
            split_type
          });
          if (exists) {
            await db.query(
              'UPDATE expense_participants SET he_participates = 1, share_amount = ? WHERE expense_id = ? AND participant_id = ?',
              [shareAmount, expenseId, participantId]
            );
          } else {
            await db.query(
              'INSERT INTO expense_participants (expense_id, participant_id, he_participates, share_amount) VALUES (?, ?, 1, ?)',
              [expenseId, participantId, shareAmount]
            );
          }
        }
      } else if (split_type === 'custom') {
        for (const participant of selectedParticipants) {
          const participantId = participant.id || participant.participant_id;
          if (!participantId) continue;
          
          const customAmount = expenseData.custom_amounts && expenseData.custom_amounts[participantId] || 0;
          const exists = existingParticipantIds.includes(participantId);
          if (exists) {
            await db.query(
              'UPDATE expense_participants SET he_participates = 1, share_amount = ? WHERE expense_id = ? AND participant_id = ?',
              [customAmount, expenseId, participantId]
            );
          } else {
            await db.query(
              'INSERT INTO expense_participants (expense_id, participant_id, he_participates, share_amount) VALUES (?, ?, 1, ?)',
              [expenseId, participantId, customAmount]
            );
          }
        }
      } else if (split_type === 'shares') {
        const totalShares = selectedParticipants.reduce((sum, p) => {
          const participantId = p.id || p.participant_id;
          if (!participantId) return sum;
          return sum + ((expenseData.shares && expenseData.shares[participantId]) || 1);
        }, 0);

        for (const participant of selectedParticipants) {
          const participantId = participant.id || participant.participant_id;
          if (!participantId) continue;
          
          const shares = (expenseData.shares && expenseData.shares[participantId]) || 1;
          const shareAmount = totalShares > 0 ? (amount * shares) / totalShares : 0;
          const exists = existingParticipantIds.includes(participantId);
          if (exists) {
            await db.query(
              'UPDATE expense_participants SET he_participates = 1, share_amount = ? WHERE expense_id = ? AND participant_id = ?',
              [shareAmount, expenseId, participantId]
            );
          } else {
            await db.query(
              'INSERT INTO expense_participants (expense_id, participant_id, he_participates, share_amount) VALUES (?, ?, 1, ?)',
              [expenseId, participantId, shareAmount]
            );
          }
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
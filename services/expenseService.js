const db = require('../db');

class ExpenseService {
  async updateExpense(expenseId, expenseData) {
    const { description, amount, event_id, paid_by, created_date, split_type, currency, participants } = expenseData;
    // Ensure created_date is in YYYY-MM-DD format for MySQL DATE type
    let formattedCreatedDate = created_date;
    if (created_date) {
      // Handles both Date objects and ISO strings
      const dateObj = (created_date instanceof Date) ? created_date : new Date(created_date);
      if (!isNaN(dateObj)) {
        formattedCreatedDate = dateObj.toISOString().slice(0, 10); // YYYY-MM-DD
      }
    }
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
        [description, amount, paid_by, formattedCreatedDate, split_type, expenseId]
      );

      // Normaliser les données des participants pour assurer la cohérence
      const normalizedParticipants = participants.map(p => ({
        id: p.id || p.participant_id,
        name: p.name,
        selected: p.selected === true || p.he_participates === 1 || p.he_participates === true
      }));

      // Filtrer les participants sélectionnés et non sélectionnés
      console.log('Filtrage des participants:', {
        total: normalizedParticipants.length,
        participants: normalizedParticipants.map(p => ({ id: p.id, selected: p.selected }))
      });
      
      const selectedParticipants = normalizedParticipants.filter(p => p.selected);
      const notSelectedParticipants = normalizedParticipants.filter(p => !p.selected);
      
      console.log('Résultat du filtrage:', {
        selectedCount: selectedParticipants.length,
        notSelectedCount: notSelectedParticipants.length
      });

      // Obtenir les IDs des participants existants
      const [rows] = await db.query(
        'SELECT GROUP_CONCAT(distinct participant_id) as participant_ids FROM expense_participants WHERE expense_id = ?',
        [expenseId]
      );
      
      // Extraire et convertir les IDs de participants de la chaîne concaténée
      const existingParticipantIds = rows.participant_ids ? rows.participant_ids.split(',') : [];
      console.log('Participants existants:', existingParticipantIds);

      // Mettre à jour les participants non sélectionnés existants
      for (const participant of notSelectedParticipants) {
        const participantId = participant.id;
        if (!participantId) continue;
        
        const exists = existingParticipantIds.includes(participantId.toString());
        
        if (exists) {
          console.log(`Mise à jour du participant ${participantId} à he_participates=0`);
          await db.query(
            'UPDATE expense_participants SET he_participates = 0, share_amount = 0 WHERE expense_id = ? AND participant_id = ?',
            [expenseId, participantId]
          );
        } else {
          console.log(`Insertion du participant ${participantId} avec he_participates=0`);
          await db.query(
            'INSERT INTO expense_participants (expense_id, participant_id, he_participates, share_amount) VALUES (?, ?, 0, 0)',
            [expenseId, participantId]
          );
        }
      }

      // Calculer et mettre à jour les montants pour les participants sélectionnés
      if (split_type === 'equal') {
        // Répartition égale
        const shareAmount = selectedParticipants.length > 0 ? parseFloat((amount / selectedParticipants.length).toFixed(2)) : 0;
        console.log(`Répartition égale: ${shareAmount} par participant`);
        
        for (const participant of selectedParticipants) {
          const participantId = participant.id;
          if (!participantId) continue;
          
          const exists = existingParticipantIds.includes(participantId.toString());
          
          // Prepare update/insert query
          let query = '';
          let params = [];

          if (exists) {
            query = 'UPDATE expense_participants SET he_participates = 1, share_amount = ?';
            params = [shareAmount];
            // Add share_count update only if split_type is 'shares'
            if (split_type === 'shares') {
              query += ', share_count = ?';
              params.push(shareCount); // shareCount can be null here
            }
            query += ' WHERE expense_id = ? AND participant_id = ?';
            params.push(expenseId, participantId);
          } else {
            query = 'INSERT INTO expense_participants (expense_id, participant_id, he_participates, share_amount';
            params = [expenseId, participantId, 1, shareAmount];
            // Add share_count insert only if split_type is 'shares'
            if (split_type === 'shares') {
              query += ', share_count';
              params.push(shareCount); // shareCount can be null here
              query += ') VALUES (?, ?, ?, ?, ?)';
            } else {
              query += ') VALUES (?, ?, ?, ?)';
            }
          }
          
          // Ensure null values are handled correctly
          await db.query(query, params.map(v => v === undefined ? null : v));
        }
      } else if (split_type === 'custom') {
        // Répartition personnalisée
        console.log('Répartition personnalisée');
        
        for (const participant of selectedParticipants) {
          const participantId = participant.id;
          if (!participantId) continue;
          
          // S'assurer que le montant personnalisé est un nombre valide
          const customAmount = expenseData.custom_amounts && parseFloat(expenseData.custom_amounts[participantId]) || 0;
          console.log(`Participant ${participantId}: montant personnalisé = ${customAmount}`);
          
          const exists = existingParticipantIds.includes(participantId.toString());
          
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
        // Répartition par parts
        console.log('Répartition par parts');
        
        // Calculer le total des parts en fonction des montants
        const totalAmount = parseFloat(amount);
        let totalShares = 0;
        
        // Première passe : calculer le total des parts
        for (const participant of selectedParticipants) {
          const participantId = participant.id;
          if (!participantId) continue;
          
          // Obtenir le montant de la part du participant
          let shareAmount = 0;
          if (expenseData.shares && expenseData.shares[participantId]) {
            // Si nous avons des parts spécifiées, calculer le montant proportionnellement
            const shares = parseFloat(expenseData.shares[participantId]);
            shareAmount = (totalAmount * shares) / 100; // Supposons que les parts sont en pourcentage
          } else if (participant.share_amount) {
            // Si nous avons un montant spécifique
            shareAmount = parseFloat(participant.share_amount);
          }
          
          // Calculer le nombre de parts en fonction du montant
          const shareCount = Math.round((shareAmount / totalAmount) * 100);
          totalShares += shareCount;
        }
        
        console.log(`Total des parts: ${totalShares}`);

        // Deuxième passe : mettre à jour les participants avec les montants et parts calculés
        for (const participant of selectedParticipants) {
          const participantId = participant.id;
          if (!participantId) continue;
          
          // Calculer le montant de la part
          let shareAmount = 0;
          let shareCount = null; // Default to null
          
          if (split_type === 'shares') { // Calculate shareCount only for 'shares'
            if (expenseData.shares && expenseData.shares[participantId]) {
              // Si nous avons des parts spécifiées, calculer le montant proportionnellement
              const shares = parseFloat(expenseData.shares[participantId]);
              shareAmount = (totalAmount * shares) / 100;
              shareCount = (!isNaN(shares) && shares >= 0) ? shares : null;
            } else if (participant.share_amount) {
              // Si nous avons un montant spécifique (moins courant pour la mise à jour des parts, mais gardé pour robustesse)
              shareAmount = parseFloat(participant.share_amount);
              // shareCount = Math.round((shareAmount / totalAmount) * 100); // Le calcul basé sur share_amount n'est peut-être pas souhaité ici
            }
          } else { // For 'equal' or 'custom', calculate only shareAmount
             if (participant.share_amount) {
               shareAmount = parseFloat(participant.share_amount);
             }
          }
          
          // S'assurer que le montant est arrondi à 2 décimales
          shareAmount = parseFloat(shareAmount.toFixed(2));
          
          console.log(`Participant ${participantId}: ${shareCount} parts = ${shareAmount}`);
          
          const exists = existingParticipantIds.includes(participantId.toString());
          
          // Prepare update/insert query
          let query = '';
          let params = [];

          if (exists) {
            query = 'UPDATE expense_participants SET he_participates = 1, share_amount = ?';
            params = [shareAmount];
            // Add share_count update only if split_type is 'shares'
            if (split_type === 'shares') {
              query += ', share_count = ?';
              params.push(shareCount); // shareCount can be null here
            }
            query += ' WHERE expense_id = ? AND participant_id = ?';
            params.push(expenseId, participantId);
          } else {
            query = 'INSERT INTO expense_participants (expense_id, participant_id, he_participates, share_amount';
            params = [expenseId, participantId, 1, shareAmount];
            // Add share_count insert only if split_type is 'shares'
            if (split_type === 'shares') {
              query += ', share_count';
              params.push(shareCount); // shareCount can be null here
              query += ') VALUES (?, ?, ?, ?, ?)';
            } else {
              query += ') VALUES (?, ?, ?, ?)';
            }
          }
          
          // Ensure null values are handled correctly
          await db.query(query, params.map(v => v === undefined ? null : v));
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
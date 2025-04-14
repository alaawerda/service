const express = require('express');
const router = express.Router();
const balanceService = require('./services/balanceService');

// Fonction pour générer un code unique pour l'événement
const generateUniqueEventCode = () => {
  const prefix = 'EV';
  const timestamp = Date.now().toString(36);
  const randomNum = Math.floor(Math.random() * 1000).toString(36);
  return `${prefix}${timestamp}${randomNum}`.toUpperCase();
};

// Fonction simplifiée pour retourner des valeurs par défaut (obsolète, à conserver pour compatibilité)
const getDefaultBalances = () => {
  return {
    debts: [],
    total_to_pay: 0,
    total_to_receive: 0
  };
};

module.exports = (db) => {
  // Get event details by ID
  router.get('/api/events/:eventId', async (req, res) => {
    try {
      const { eventId } = req.params;
      const userId = req.query.userId;
      
      const query = `
        SELECT
          e.*,
          GROUP_CONCAT(DISTINCT p.id) as participant_ids,
          GROUP_CONCAT(DISTINCT p.name) as participant_names,
          GROUP_CONCAT(DISTINCT p.custom_amount) as participant_amounts,
          (SELECT COUNT(*) FROM expenses WHERE event_id = e.id) as expenseCount,
          (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE event_id = e.id) as totalExpenseAmount
        FROM
          events e
          LEFT JOIN participants p ON e.id = p.event_id
        WHERE
          e.id = ?
        GROUP BY
          e.id
      `;

      const getEventDetails = new Promise((resolve, reject) => {
        db.query(query, [eventId], (err, results) => {
          if (err) {
            console.error('[Event Details] Database error:', err);
            reject(err);
            return;
          }

          if (results.length === 0) {
            console.log(`[Event Details] Event not found: ${eventId}`);
            reject(new Error('Event not found'));
            return;
          }

          const event = results[0];
          console.log(`[Event Details] Found event: ${event.id}, Participants: ${event.participant_names || 'none'}`);

          event.participants = event.participant_names
            ? event.participant_names.split(',').map((name, index) => ({
                id: event.participant_ids ? event.participant_ids.split(',')[index] : null,
                name,
                customAmount: event.participant_amounts
                  ? event.participant_amounts.split(',')[index] || null
                  : null
              }))
            : [];

          // Initialize expenses array if not already set
          const expenses = results[1] || [];
          
          delete event.participant_ids;
          delete event.participant_names;
          delete event.participant_amounts;
          delete event.expense_amounts;
          delete event.paid_by_list;
          delete event.split_types;
          delete event.expense_participant_ids;
          delete event.expense_share_amounts;

          // Calculer les dettes entre participants
          balanceService.calculateDebts(eventId, userId)
            .then(balances => {
              console.log(`[Event Details] Calculated balances for event: ${eventId}`);
              event.debts = balances.debts;
              event.total_to_pay = balances.total_to_pay;
              event.total_to_receive = balances.total_to_receive;
              resolve(event);
            })
            .catch(error => {
              console.error('[Event Details] Error calculating balances:', error);
              // En cas d'erreur, on continue avec des valeurs par défaut
              const defaultBalances = getDefaultBalances();
              event.debts = defaultBalances.debts;
              event.total_to_pay = defaultBalances.total_to_pay;
              event.total_to_receive = defaultBalances.total_to_receive;
              resolve(event);
            });
        });
      });

      const getExpenses = new Promise((resolve, reject) => {
        console.log('[Event Details] Fetching expenses for event:', eventId);
        const expensesQuery = `
          SELECT e.*, ep.participant_id, ep.share_amount, ep.he_participates
          FROM expenses e
          LEFT JOIN expense_participants ep ON e.id = ep.expense_id
          WHERE e.event_id = ?
          ORDER BY e.created_date DESC
        `;
        db.query(expensesQuery, [eventId], (err, expensesResults) => {
          if (err) {
            console.error('Database error:', err);
            reject(err);
            return;
          }
          resolve(expensesResults || []);
        });
      });

      const [event, expenses] = await Promise.all([getEventDetails, getExpenses]);
      event.expenses = expenses;
      res.json(event);

    } catch (error) {
      console.error('Server error:', error);
      if (error.message === 'Event not found') {
        res.status(404).json({ error: 'Event not found' });
      } else {
        res.status(500).json({ error: 'Server error' });
      }
    }
  });

  // Get event expenses
  router.get('/api/events/:eventId/expenses', async (req, res) => {
    try {
      const { eventId } = req.params;

      const query = `
        SELECT e.*, ep.participant_id, ep.share_amount, ep.he_participates
        FROM expenses e
        LEFT JOIN expense_participants ep ON e.id = ep.expense_id
        WHERE e.event_id = ?
        ORDER BY e.created_date DESC
      `;

      db.query(query, [eventId], (err, results) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        const expenses = [];
        const expenseMap = new Map();

        results.forEach(row => {
          if (!expenseMap.has(row.id)) {
            const expense = {
              ...row,
              participants: []
            };
            delete expense.participant_id;
            delete expense.share_amount;
            expenseMap.set(row.id, expense);
            expenses.push(expense);
          }

          if (row.participant_id) {
            const expense = expenseMap.get(row.id);
            expense.participants.push({
              participant_id: row.participant_id,
              share_amount: row.share_amount,
              he_participates: row.he_participates
            });
          }
        });

        res.json(expenses);
      });
    } catch (error) {
      console.error('Server error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Get all events
  router.get('/api/events', async (req, res) => {
    try {
      const query = `
        SELECT e.*,
          GROUP_CONCAT(DISTINCT p.name) as participant_names,
          GROUP_CONCAT(DISTINCT p.custom_amount) as participant_amounts,
          COUNT(DISTINCT ex.id) as expenseCount,
          COALESCE(SUM(ex.amount) / NULLIF(COUNT(DISTINCT p.id), 0), 0) as totalExpenseAmount,
          GROUP_CONCAT(DISTINCT ex.amount) as expense_amounts,
          GROUP_CONCAT(DISTINCT ex.paid_by) as paid_by_list,
          GROUP_CONCAT(DISTINCT ex.split_type) as split_types
        FROM events e
        LEFT JOIN participants p ON e.id = p.event_id
        LEFT JOIN expenses ex ON e.id = ex.event_id
        GROUP BY e.id
        ORDER BY e.created_at DESC
      `;

      db.query(query, [], (err, results) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        const events = results.map(event => {
          event.participants = event.participant_names
            ? event.participant_names.split(',').map((name, index) => ({
                name,
                customAmount: event.participant_amounts
                  ? event.participant_amounts.split(',')[index] || null
                  : null
              }))
            : [];

          // Calculate balances if there are expenses
          if (event.expense_amounts) {
            // Get userId from query parameter
            const userId = req.query.userId;
            const eventBalances = getDefaultBalances(event.participants, userId);

            // Utiliser les valeurs par défaut
            event.amountToPay = 0;
            event.amountToReceive = 0;
          } else {
            event.amountToPay = 0;
            event.amountToReceive = 0;
          }

          delete event.participant_names;
          delete event.participant_amounts;
          delete event.expense_amounts;
          delete event.paid_by_list;
          delete event.split_types;

          return event;
        });

        res.json(events);
      });
    } catch (error) {
      console.error('Server error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Get expense details
  router.get('/api/expenses/:expenseId', async (req, res) => {
    try {
      const { expenseId } = req.params;
      console.log('[Get Expense] Request received:', { expenseId });

      console.log('[Get Expense] Executing database query...');
      const query = `
       SELECT 
    e.*,
    GROUP_CONCAT(p.id ORDER BY p.id) AS participant_ids,
    GROUP_CONCAT(p.name ORDER BY p.id) AS participant_names,
    GROUP_CONCAT(ep.share_amount ORDER BY p.id) AS participant_shares,
    GROUP_CONCAT(ep.he_participates ORDER BY p.id) AS participant_participates
FROM expenses e
LEFT JOIN expense_participants ep ON e.id = ep.expense_id
LEFT JOIN participants p ON ep.participant_id = p.id
WHERE e.id = ? 
GROUP BY e.id;
      `;

      db.query(query, [expenseId], (err, results) => {
        if (err) {
          console.error('[Get Expense] Database error:', {
            error: err.message,
            expenseId
          });
          return res.status(500).json({ error: 'Database error' });
        }

        if (!results || results.length === 0) {
          console.log('[Get Expense] Expense not found:', expenseId);
          return res.status(404).json({ error: 'Expense not found' });
        }

        const expenseData = results[0];
        
        // Process the concatenated data into a structured format
        const participantIds = expenseData.participant_ids ? expenseData.participant_ids.split(',') : [];
        const participantNames = expenseData.participant_names ? expenseData.participant_names.split(',') : [];
        const participantShares = expenseData.participant_shares ? expenseData.participant_shares.split(',') : [];
        const participantParticipates = expenseData.participant_participates ? expenseData.participant_participates.split(',') : [];
        
        // Map participants data
        expenseData.participants = participantIds.map((id, index) => ({
          participant_id: id,
          name: participantNames[index] || '',
          share_amount: parseFloat(participantShares[index] || 0),
          he_participates: participantParticipates[index] === '1'
        })).filter(p => p.participant_id);

        // Remove temporary fields
        delete expenseData.participant_ids;
        delete expenseData.participant_names;
        delete expenseData.participant_shares;
        delete expenseData.participant_participates;

        console.log('[Get Expense] Successfully retrieved expense:', {
          expenseId,
          participantCount: expenseData.participants.length
        });

        res.json(expenseData);
      });
    } catch (error) {
      console.error('Server error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Get expense details (alternative implementation)
  router.get('/api/expenses/:expenseId/details', async (req, res) => {
    try {
      const { expenseId } = req.params;
      
      db.query(`SELECT * FROM expenses WHERE id = ?`, [expenseId], (err, results) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Database error' });
        }
        
        if (!results || results.length === 0) {
          return res.status(404).json({ error: 'Expense not found' });
        }
        
        console.log('[Get Expense] Database query successful:', {
          expenseId,
          rowCount: results.length
        });

        const expense = results[0];
        console.log('[Get Expense] Raw expense data:', {
          id: expense.id,
          description: expense.description,
          amount: expense.amount,
          split_type: expense.split_type
        });

        const participantNames = expense.participant_names ? expense.participant_names.split(',') : [];
        const participantIds = expense.participant_ids ? expense.participant_ids.split(',') : [];

        console.log('[Get Expense] Processing participants:', {
          participantCount: participantNames.length,
          names: participantNames,
          ids: participantIds
        });

        expense.participants = participantNames.map((name, index) => ({
          id: participantIds[index],
          name: name,
          share_amount: expense.share_amount
        }));

        // Calculate individual shares based on split type
        if (expense.split_type === 'equal') {
          const shareAmount = expense.amount / expense.participants.length;
          if (!expense.participants) return;
          expense.participants.forEach(participant => {
            participant.share_amount = shareAmount;
          });
        }

        delete expense.participant_names;
        delete expense.participant_ids;
        delete expense.participant_id;
        delete expense.share_amount;

        console.log('[Get Expense] Sending response:', {
          expenseId: expense.id,
          participantCount: expense.participants.length,
          totalAmount: expense.amount
        });

        res.json(expense);
      });
    } catch (error) {
      console.error('Server error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Vérifier si un participant a des dépenses
  router.get('/api/events/:eventId/participants/:participantId/expenses', async (req, res) => {
    try {
      const { eventId, participantId } = req.params;

      const query = `
        SELECT COUNT(*) as expenseCount
        FROM expenses e
        LEFT JOIN expense_participants ep ON e.id = ep.expense_id
        LEFT JOIN participants p ON ep.participant_id = p.id
        WHERE e.event_id = ? AND p.id = ?
      `;

      db.query(query, [eventId, participantId], (err, results) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        const hasExpenses = results[0].expenseCount > 0;
        res.json({ hasExpenses });
      });
    } catch (error) {
      console.error('Server error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Get event balances
  router.get('/api/events/:eventId/balances', async (req, res) => {
    try {
      const { eventId } = req.params;
      const userId = req.query.userId;

      if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
      }

      // Utiliser le service de calcul des dettes
      const balances = await balanceService.calculateDebts(eventId, userId);
      
      res.json(balances);
    } catch (error) {
      console.error('Server error:', error);
      if (error.message === 'Event not found') {
        return res.status(404).json({ error: 'Event not found' });
      }
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Get user balances for an event
  router.get('/api/events/:eventId/user-balances', async (req, res) => {
    try {
      const { eventId } = req.params;
      const userId = req.query.userId;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Utiliser le service de calcul des dettes
      const balances = await balanceService.calculateDebts(eventId, userId);
      
      // Récupérer les dépenses payées par l'utilisateur
      const [participantRows] = await db.query(
        `SELECT p.id, p.name FROM participants p WHERE p.event_id = ? AND p.user_id = ?`,
        [eventId, userId]
      );
      
      if (participantRows.length === 0) {
        return res.json({
          ...balances,
          paidExpenses: [],
          transactions: balances.debts
        });
      }
      
      const userParticipant = participantRows[0];
      
      // Récupérer les dépenses payées par l'utilisateur
      const [expenseRows] = await db.query(
        `SELECT e.id, e.description, e.amount, e.created_date 
         FROM expenses e 
         WHERE e.event_id = ? AND e.paid_by = ?`,
        [eventId, userParticipant.name]
      );
      
      const paidExpenses = expenseRows.map(expense => ({
        id: expense.id,
        amount: parseFloat(expense.amount),
        description: expense.description,
        created_date: expense.created_date
      }));
      
      // Transformer les dettes en transactions pour l'utilisateur
      const transactions = balances.debts.filter(debt => 
        debt.from === userParticipant.name || debt.to === userParticipant.name
      ).map(debt => {
        if (debt.from === userParticipant.name) {
          return {
            ...debt,
            type: 'to_pay',
            label: `Vous devez ${debt.amount} à ${debt.to}`
          };
        } else {
          return {
            ...debt,
            type: 'to_receive',
            label: `${debt.from} vous doit ${debt.amount}`
          };
        }
      });
      
      res.json({
        ...balances,
        paidExpenses,
        transactions
      });
    } catch (error) {
      console.error('Server error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Update event
  router.put('/api/events/:eventId', async (req, res) => {
    try {
      const { eventId } = req.params;
      const { name, startDate, endDate, currency, participants, userId } = req.body;

      // Validate input
      if (!name || !startDate || !endDate || !currency || !participants || !Array.isArray(participants)) {
        return res.status(400).json({ error: 'Invalid input data' });
      }

      // Get current event data
      const getEventQuery = 'SELECT * FROM events WHERE id = ?';
      db.query(getEventQuery, [eventId], async (err, eventResults) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (eventResults.length === 0) {
          return res.status(404).json({ error: 'Event not found' });
        }

        // Get current participants
        const getParticipantsQuery = 'SELECT * FROM participants WHERE event_id = ?';
        db.query(getParticipantsQuery, [eventId], async (err, currentParticipants) => {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
          }

          // Update event details
          const updateEventQuery = `
            UPDATE events 
            SET name = ?, start_date = ?, end_date = ?, currency = ?, split_type = ?
            WHERE id = ?
          `;

          // Utiliser split_type du corps de la requête, avec fallback sur splitType pour compatibilité
          const splitTypeValue = req.body.split_type || req.body.splitType || 'equal';
          console.log('[Update Event] Using split_type:', splitTypeValue);

          db.query(
            updateEventQuery,
            [name, startDate, endDate, currency, splitTypeValue, eventId],
            async (err) => {
              if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
              }

              // Get all expenses for this event to manage participants
              const getExpensesQuery = 'SELECT id FROM expenses WHERE event_id = ?';
              db.query(getExpensesQuery, [eventId], async (err, expenses) => {
                if (err) {
                  console.error('Database error when fetching expenses:', err);
                  return res.status(500).json({ error: 'Database error' });
                }

                // Handle participants
                const participantPromises = [];

                // 1. Identify new participants (those not in the current list)
                const newParticipants = participants.filter(
                  p => !currentParticipants.some(cp => cp.id === p.id)
                );

                // 2. Add new participants
                for (const participant of newParticipants) {
                  participantPromises.push(
                    db.query(
                      'INSERT INTO participants (event_id, name, user_id, custom_amount) VALUES (?, ?, ?, ?)',
                      [eventId, participant.name, participant.user_id || null, participant.custom_amount || null]
                    )
                  );
                }

                // 3. Update existing participants
                for (const participant of participants) {
                  const existingParticipant = currentParticipants.find(cp => cp.id === participant.id);
                  if (existingParticipant) {
                    participantPromises.push(
                      db.query(
                        'UPDATE participants SET name = ?, custom_amount = ? WHERE id = ?',
                        [participant.name, participant.custom_amount || null, participant.id]
                      )
                    );
                  }
                }

                // 4. Execute all participant updates
                await Promise.all(participantPromises);

                // 5. Return success response
                res.json({
                  success: true,
                  message: 'Event updated successfully'
                });
              });
            }
          );
        });
      });
    } catch (error) {
      console.error('Server error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  return router;
};
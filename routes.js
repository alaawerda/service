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

// API pour rejoindre un événement par code et lier un participant à l'utilisateur connecté
router.post('/api/join-event', async (req, res) => {
  try {
    const { userId, participantId } = req.body;
    if (!userId || !participantId) {
      return res.status(400).json({ error: 'Code et utilisateur requis' });
    }
    // Vérifier si le participant est déjà lié à un utilisateur
    const participantRows = await db.query('SELECT user_id, event_id FROM participants WHERE id = ?', [participantId]);
    if (!participantRows || participantRows.length === 0) {
      return res.status(404).json({ error: 'Participant introuvable' });
    }
    // Vérifier si ce user participe déjà à cet event
    const eventId = participantRows[0].event_id;
    const alreadyParticipant = await db.query('SELECT id FROM participants WHERE event_id = ? AND user_id = ?', [eventId, userId]);
    if (alreadyParticipant && alreadyParticipant.length > 0) {
      return res.status(409).json({ error: 'Vous participez déjà à cet événement.' });
    }
    if (participantRows[0].user_id) {
      return res.status(409).json({ error: 'Ce participant est déjà lié à un utilisateur.' });
    }
    // Fetch the username for the given userId
    const userRows = await db.query('SELECT username FROM users WHERE id = ?', [userId]);
    if (!userRows || userRows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }
    const username = userRows[0].username;
    // Update the participant with the user_id and username
    await db.query('UPDATE participants SET user_id = ?, name = ? WHERE id = ?', [userId, username, participantId]);
    return res.json({ success: true });
  } catch (error) {
    console.error('Erreur join-event:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
  // Nouvelle route : récupérer les participants d'un événement par code
  router.get('/api/events/by-code/:eventCode/participants', async (req, res) => {
    try {
      const { eventCode } = req.params;
  
      //const eventResults = await db.query(eventQuery, [eventCode]);
      const eventResults = await db.query('SELECT* FROM events WHERE code = ?', [eventCode]);

      if (!eventResults || eventResults.length === 0) {
        return res.status(404).json({ error: "Événement introuvable" });
      }
      const eventId = eventResults[0].id;
      const eventName = eventResults[0].name;
      const participantsQuery = 'SELECT id, name, user_id FROM participants WHERE event_id = ?';
      const participants = await db.query(participantsQuery, [eventId]);
      res.json({ eventName, participants });
    } catch (error) {
      console.error("Erreur lors de la récupération des participants par code:", error);
      res.status(500).json({ error: "Erreur serveur lors de la récupération des participants" });
    }
  });
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

      // Utiliser l'API promise de mysql2 au lieu des callbacks
      const eventResults = await db.query(query, [eventId]);
      
      if (!eventResults || eventResults.length === 0) {
        console.log(`[Event Details] Event not found: ${eventId}`);
        return res.status(404).json({ error: 'Event not found' });
      }

      const event = eventResults[0];
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
      
      delete event.participant_ids;
      delete event.participant_names;
      delete event.participant_amounts;
      delete event.expense_amounts;
      delete event.paid_by_list;
      delete event.split_types;
      delete event.expense_participant_ids;
      delete event.expense_share_amounts;

      // Compute sum of share_amount for the logged-in user, default to 0 if missing
      const shareQuery = `
        SELECT COALESCE(SUM(ep.share_amount), 0) AS myShareTotal
        FROM expense_participants ep
        JOIN expenses e ON ep.expense_id = e.id
        JOIN participants p ON ep.participant_id = p.id
        WHERE e.event_id = ? AND p.user_id = ?
      `;
      const [shareRows] = await db.query(shareQuery, [eventId, userId]);
      // Debug shareRows and computed myShareTotal
      console.log('[Event Details] shareRows:', shareRows);
      console.log(`[Event Details] My Expenses total for user ${userId}:`, shareRows?.[0]?.myShareTotal);
      const myShareTotal =shareRows;
      console.log(`[Event Details] My Expenses total for user ${userId}:`, Number(shareRows?.myShareTotal ?? 0));
      event.myShareTotal = Number(shareRows?.myShareTotal ?? 0);

      // Récupérer les dépenses
      console.log('[Event Details] Fetching expenses for event:', eventId);
      const expensesQuery = `
        SELECT e.*, ep.participant_id, ep.share_amount, ep.he_participates
        FROM expenses e
        LEFT JOIN expense_participants ep ON e.id = ep.expense_id
        WHERE e.event_id = ?
        ORDER BY e.created_date DESC
      `;
      const expenses = await db.query(expensesQuery, [eventId]);
      
      // Calculer les dettes entre participants
      try {
        const balances = await balanceService.calculateDebts(eventId, userId);
        console.log(`[Event Details] Calculated balances for event: ${eventId}`);
        event.debts = balances.debts;
        event.total_to_pay = balances.total_to_pay;
        event.total_to_receive = balances.total_to_receive;
      } catch (error) {
        console.error('[Event Details] Error calculating balances:', error);
        // En cas d'erreur, on continue avec des valeurs par défaut
        const defaultBalances = getDefaultBalances();
        event.debts = defaultBalances.debts;
        event.total_to_pay = defaultBalances.total_to_pay;
        event.total_to_receive = defaultBalances.total_to_receive;
      }

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
       SELECT 
          e.*, 
          ep.participant_id, 
          ep.share_amount, 
          ep.he_participates,
          p.name AS participant_name -- Ajout du nom d'utilisateur
        FROM expenses e
        LEFT JOIN expense_participants ep ON e.id = ep.expense_id
        LEFT JOIN participants as p on ep.participant_id = p.id
        WHERE e.event_id = ?
        ORDER BY e.created_date DESC
      `;

      // Utiliser l'API promise de mysql2 au lieu des callbacks
      const results = await db.query(query, [eventId]);
      
      if (!results) {
        console.error('Database error: No results returned');
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
            name: row.participant_name, // Utilisation du nom d'utilisateur récupéré
            share_amount: row.share_amount,
            he_participates: row.he_participates
          });
        }
      });

      res.json(expenses);
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

      // Utiliser l'API promise de mysql2 au lieu des callbacks
      const results = await db.query(query, []);
      
      if (!results) {
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
      // Requête améliorée pour récupérer toutes les informations nécessaires, y compris les parts pour le split_type 'shares'
      const query = `
       SELECT 
    e.*,
    GROUP_CONCAT(p.id ORDER BY p.id) AS participant_ids,
    GROUP_CONCAT(p.name ORDER BY p.id) AS participant_names,
    GROUP_CONCAT(ep.share_amount ORDER BY p.id) AS participant_shares,
    GROUP_CONCAT(ep.share_count ORDER BY p.id) AS participant_share_counts, -- Added share_count
    GROUP_CONCAT(ep.he_participates ORDER BY p.id) AS participant_participates
FROM expenses e
LEFT JOIN expense_participants ep ON e.id = ep.expense_id
LEFT JOIN participants p ON ep.participant_id = p.id
WHERE e.id = ? 
GROUP BY e.id;
      `;

      // Utiliser l'API promise de mysql2 au lieu des callbacks
      const results = await db.query(query, [expenseId]);
      
      if (!results || results.length === 0) {
        console.log('[Get Expense] Expense not found:', expenseId);
        return res.status(404).json({ error: 'Expense not found' });
      }

      const expenseData = results[0];
      
      // Process the concatenated data into a structured format
      const participantIds = expenseData.participant_ids ? expenseData.participant_ids.split(',') : [];
      const participantNames = expenseData.participant_names ? expenseData.participant_names.split(',') : [];
      const participantShares = expenseData.participant_shares ? expenseData.participant_shares.split(',') : [];
      const participantShareCounts = expenseData.participant_share_counts ? expenseData.participant_share_counts.split(',') : []; // Added share_counts
      const participantParticipates = expenseData.participant_participates ? expenseData.participant_participates.split(',') : [];
      
      // Récupérer tous les participants de l'événement pour s'assurer d'inclure même ceux qui ne participent pas
      const eventId = expenseData.event_id;
      const allParticipantsQuery = 'SELECT id, name FROM participants WHERE event_id = ?';
      const allParticipants = await db.query(allParticipantsQuery, [eventId]);
      
      // Créer un mapping des participants existants dans la dépense
      const existingParticipantsMap = {};
      participantIds.forEach((id, index) => {
        existingParticipantsMap[id] = {
          participant_id: id,
          name: participantNames[index] || '',
          share_amount: parseFloat(participantShares[index] || 0),
          share_count: parseInt(participantShareCounts[index] || 1), // Added share_count, default to 1
          he_participates: participantParticipates[index] === '1'
        };
      });
      
      // Note: share_count est maintenant récupéré directement depuis la base de données
      // et n'est plus recalculé ici pour le type 'shares'.
      // La valeur de la base de données est utilisée telle quelle.
      
      // Construire la liste complète des participants, y compris ceux qui ne participent pas
      expenseData.participants = allParticipants.map(p => {
        if (existingParticipantsMap[p.id]) {
          return existingParticipantsMap[p.id];
        } else {
          // Participant qui n'est pas dans la dépense
          return {
            participant_id: p.id,
            name: p.name,
            share_amount: 0,
            he_participates: false,
            share_count: 1 // Valeur par défaut pour les parts
          };
        }
      });

      // Remove temporary fields
      delete expenseData.participant_ids;
      delete expenseData.participant_names;
      delete expenseData.participant_shares;
      delete expenseData.participant_participates;

      console.log('[Get Expense] Successfully retrieved expense:', {
        expenseId,
        participantCount: expenseData.participants.length,
        split_type: expenseData.split_type
      });

      res.json(expenseData);
    } catch (error) {
      console.error('Server error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Get expense details (alternative implementation)
  router.get('/api/expenses/:expenseId/details', async (req, res) => {
    try {
      const { expenseId } = req.params;
      
      // Utiliser la route principale pour assurer la cohérence
      // Rediriger vers la route principale
      console.log('[Get Expense Details] Redirecting to main expense endpoint');
      
      // Récupérer les détails de la dépense avec la requête complète
      const query = `
       SELECT 
    e.*,
    GROUP_CONCAT(p.id ORDER BY p.id) AS participant_ids,
    GROUP_CONCAT(p.name ORDER BY p.id) AS participant_names,
    GROUP_CONCAT(ep.share_amount ORDER BY p.id) AS participant_shares,
    GROUP_CONCAT(ep.share_count ORDER BY p.id) AS participant_share_counts, -- Added share_count
    GROUP_CONCAT(ep.he_participates ORDER BY p.id) AS participant_participates
FROM expenses e
LEFT JOIN expense_participants ep ON e.id = ep.expense_id
LEFT JOIN participants p ON ep.participant_id = p.id
WHERE e.id = ? 
GROUP BY e.id;
      `;

      // Utiliser l'API promise de mysql2 au lieu des callbacks
      const results = await db.query(query, [expenseId]);
      
      if (!results || results.length === 0) {
        console.log('[Get Expense Details] Expense not found:', expenseId);
        return res.status(404).json({ error: 'Expense not found' });
      }

      const expenseData = results[0];
      
      // Process the concatenated data into a structured format
      const participantIds = expenseData.participant_ids ? expenseData.participant_ids.split(',') : [];
      const participantNames = expenseData.participant_names ? expenseData.participant_names.split(',') : [];
      const participantShares = expenseData.participant_shares ? expenseData.participant_shares.split(',') : [];
      const participantParticipates = expenseData.participant_participates ? expenseData.participant_participates.split(',') : [];
      
      // Récupérer tous les participants de l'événement
      const eventId = expenseData.event_id;
      const allParticipantsQuery = 'SELECT id, name FROM participants WHERE event_id = ?';
      const allParticipants = await db.query(allParticipantsQuery, [eventId]);
      
      // Créer un mapping des participants existants dans la dépense
      const existingParticipantsMap = {};
      participantIds.forEach((id, index) => {
        existingParticipantsMap[id] = {
          participant_id: id,
          name: participantNames[index] || '',
          share_amount: parseFloat(participantShares[index] || 0),
          share_count: parseInt(participantShareCounts[index] || 1), // Added share_count, default to 1
          he_participates: participantParticipates[index] === '1'
        };
      });
      
      // Note: share_count est maintenant récupéré directement depuis la base de données
      // et n'est plus recalculé ici pour le type 'shares'.
      // La valeur de la base de données est utilisée telle quelle.
      
      // Construire la liste complète des participants
      expenseData.participants = allParticipants.map(p => {
        if (existingParticipantsMap[p.id]) {
          return existingParticipantsMap[p.id];
        } else {
          // Participant qui n'est pas dans la dépense
          return {
            participant_id: p.id,
            name: p.name,
            share_amount: 0,
            he_participates: false,
            share_count: 1 // Valeur par défaut pour les parts
          };
        }
      });

      // Remove temporary fields
      delete expenseData.participant_ids;
      delete expenseData.participant_names;
      delete expenseData.participant_shares;
      delete expenseData.participant_participates;

      console.log('[Get Expense Details] Successfully retrieved expense:', {
        expenseId,
        participantCount: expenseData.participants.length,
        split_type: expenseData.split_type
      });

      res.json(expenseData);
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

      // Utiliser l'API promise de mysql2 au lieu des callbacks
      const results = await db.query(query, [eventId, participantId]);
      
      if (!results || results.length === 0) {
        return res.status(500).json({ error: 'Database error' });
      }

      const hasExpenses = results[0].expenseCount > 0;
      res.json({ hasExpenses });
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
const eventResults = await db.query(getEventQuery, [eventId]);
if (!eventResults || eventResults.length === 0) {
  return res.status(404).json({ error: 'Event not found' });
}

// Get current participants
const getParticipantsQuery = 'SELECT * FROM participants WHERE event_id = ?';
const currentParticipants = await db.query(getParticipantsQuery, [eventId]);

// Update event details
const updateEventQuery = `
  UPDATE events 
  SET name = ?, start_date = ?, end_date = ?, currency = ?, split_type = ?
  WHERE id = ?
`;
const splitTypeValue = req.body.split_type || req.body.splitType || 'equal';
await db.query(
  updateEventQuery,
  [name, startDate, endDate, currency, splitTypeValue, eventId]
);

// Get all expenses for this event to manage participants
const getExpensesQuery = 'SELECT id FROM expenses WHERE event_id = ?';
const expenses = await db.query(getExpensesQuery, [eventId]);

// Handle participants
const participantPromises = [];

// 1. Identify new participants (those not in the current list)
const newParticipants = participants.filter(
  p => !currentParticipants.some(cp => cp.name === p.name)
);
console.log('Current participants:', currentParticipants);
  console.log('New participants:', newParticipants); // Ajout d'un log pour déboguer les nouvelles participations
// 2. Add new participants
for (const participant of newParticipants) {
  /*participantPromises.push(
    db.query(
      'INSERT INTO participants (event_id, name, user_id, custom_amount) VALUES (?, ?, ?, ?)',
      [eventId, participant.name, participant.user_id || null, participant.custom_amount || null]
    )


  );*/


  console.log('[Update Event] Inserting new participant:', {eventId, participantName: participant.name});
  const insertResult = await db.query(
    'INSERT INTO participants (event_id, name, user_id, custom_amount) VALUES (?, ?, ?, ?)',
    [eventId, participant.name, participant.user_id || null, participant.custom_amount || null]
  );
  const participantId = insertResult.insertId;
  console.log('[Update Event] Participant inserted with ID:', participantId);





  // Add new participants to expenses with he_participates = 0 and share_amount = 0
 for (const expense of expenses) {
    await db.query(
      'INSERT INTO expense_participants (expense_id, participant_id, he_participates, share_amount) VALUES (?, ?, 0, 0)',
      [expense.id, participantId]
    );
    console.log('Added new participant to expenses:', {participantId, expenseId: expense.id});
  }
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
  message: 'Event updated successfully',
  eventId,
  updatedFields: { name, startDate, endDate, currency, splitTypeValue, participants }
});
  } catch (error) {
    console.error('[Update Event] Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete event endpoint
router.delete('/api/events/:id', async (req, res) => {
  try {
    const eventId = req.params.id;
    
    console.log('[Delete Event] Request received:', { eventId });

    // Check if event exists
    const [eventRows] = await db.query('SELECT id FROM events WHERE id = ?', [eventId]);
    if (!eventRows || eventRows.length === 0) {
      console.log('[Delete Event] Event not found:', eventId);
      return res.status(404).json({ error: 'Event not found' });
    }

    // Delete event (cascade will handle participants and expenses)
    await db.query('DELETE FROM events WHERE id = ?', [eventId]);

    console.log('[Delete Event] Successfully deleted event:', { eventId });
    res.json({ success: true });
  } catch (error) {
    console.error('[Delete Event] Error:', {
      message: error.message,
      stack: error.stack,
      eventId: req.params.id
    });
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// Get debts for user
router.get('/api/debts/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get all events where the user is a participant
    const eventsQuery = `
      SELECT DISTINCT e.id, e.name as event_name, e.currency
      FROM events e
      JOIN participants p ON e.id = p.event_id
      WHERE p.user_id = ?
    `;
    const events = await db.query(eventsQuery, [userId]);
    
    const debts = [];
    
    // For each event, calculate the debts
    for (const event of events) {
      const balances = await balanceService.calculateDebts(event.id, userId);
      
      // Get the user's participant name
      const userParticipantQuery = `
        SELECT name FROM participants 
        WHERE event_id = ? AND user_id = ?
      `;
      const userParticipantResult = await db.query(userParticipantQuery, [event.id, userId]);
      
      if (userParticipantResult && userParticipantResult.length > 0) {
        const userName = userParticipantResult[0].name;
        
        // Find debts where the user is the debtor (from)
        const userDebts = balances.debts.filter(debt => 
          debt.from === userName && debt.amount > 0
        );
        
        // Add event information to each debt
        const debtsWithEvent = userDebts.map(debt => ({
          id: event.id, // Using event id as debt id for now
          amount: debt.amount,
          creditor: {
            name: debt.to
          },
          event: {
            id: event.id,
            name: event.event_name,
            currency: event.currency
          }
        }));
        
        debts.push(...debtsWithEvent);
      }
    }
    
    res.json({ debts });
  } catch (error) {
    console.error('Error fetching debts:', error);
    res.status(500).json({ error: 'Failed to fetch debts' });
  }
});

// Create a new reimbursement
router.post('/api/reimbursements', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const { event_id, from, to, amount, currency } = req.body;

    // Vérifier que tous les paramètres requis sont présents
    if (!event_id || !from || !to || !amount || !currency) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Récupérer les IDs des participants
    const debtorResult = await db.query(
      'SELECT id FROM participants WHERE event_id = ? AND name = ?',
      [event_id, from]
    );
    const creditorResult = await db.query(
      'SELECT id FROM participants WHERE event_id = ? AND name = ?',
      [event_id, to]
    );
    
    // Check if results exist and have at least one row
    if (!debtorResult || debtorResult.length === 0 || !creditorResult || creditorResult.length === 0) {
      return res.status(400).json({ error: 'Participants not found' });
    }
    
    const debtor = debtorResult[0];
    const creditor = creditorResult[0];

    // Vérifier que le débiteur est bien l'utilisateur connecté
    /* (debtor.id !== parseInt(userId)) {
      return res.status(403).json({ error: 'You can only create reimbursements for yourself' });
    }*/

    // Insérer le remboursement avec le statut 'completed'
    const result = await db.query(
      'INSERT INTO reimbursements (event_id, debtor_id, creditor_id, amount, date, status, currency) VALUES (?, ?, ?, ?, NOW(), ?, ?)',
      [event_id, debtor.id, creditor.id, amount, 'completed', currency]
    );

    res.status(201).json({ id: result.insertId });
  } catch (error) {
    console.error('Error creating reimbursement:', error);
    res.status(500).json({ error: 'Failed to create reimbursement' });
  }
});

// Update reimbursement status
router.patch('/api/reimbursements/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // Get the reimbursement details
    const reimbursementQuery = `
      SELECT r.*, p.user_id as creditor_user_id
      FROM reimbursements r
      JOIN participants p ON r.creditor_id = p.id
      WHERE r.id = ?
    `;
    const reimbursementResult = await db.query(reimbursementQuery, [id]);
    
    if (!reimbursementResult || reimbursementResult.length === 0) {
      return res.status(404).json({ error: 'Reimbursement not found' });
    }
    
    const reimbursement = reimbursementResult[0];
    
    // Verify the user is either the debtor or creditor
    const isCreditor = reimbursement.creditor_user_id === req.user.id;
    const isDebtor = reimbursement.debtor_id === req.user.id;
    
    if (!isCreditor && !isDebtor) {
      return res.status(403).json({ error: 'Unauthorized: Only the debtor or creditor can update the status' });
    }
    
    // Only allow status updates based on user role
    if (isDebtor && status !== 'completed') {
      return res.status(403).json({ error: 'Debtor can only mark as completed' });
    }
    
    if (isCreditor && !['completed', 'disputed'].includes(status)) {
      return res.status(403).json({ error: 'Creditor can only mark as completed or disputed' });
    }
    
    const updateQuery = 'UPDATE reimbursements SET status = ? WHERE id = ?';
    await db.query(updateQuery, [status, id]);
    
    res.json({ message: 'Reimbursement status updated successfully' });
  } catch (error) {
    console.error('Error updating reimbursement status:', error);
    res.status(500).json({ error: 'Failed to update reimbursement status' });
  }
});

// Get reimbursement history for a user
router.get('/api/reimbursements/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const query = `
      SELECT r.*, 
             e.name as event_name,
             pd.name as debtor_name,
             pc.name as creditor_name
      FROM reimbursements r
      JOIN participants pd ON r.debtor_id = pd.id
      JOIN participants pc ON r.creditor_id = pc.id
      JOIN events e ON pd.event_id = e.id
      WHERE pd.user_id = ? OR pc.user_id = ?
      ORDER BY r.created_at DESC
    `;
    
    const reimbursements = await db.query(query, [userId, userId]);
    
    res.json({ reimbursements });
  } catch (error) {
    console.error('Error fetching reimbursement history:', error);
    res.status(500).json({ error: 'Failed to fetch reimbursement history' });
  }
});

  return router;
};

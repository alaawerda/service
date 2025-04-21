const db = require('../db');

class BalanceService {
  /**
   * Calcule les dettes entre participants d'un événement
   * @param {number} eventId - ID de l'événement
   * @param {number} connectedUserId - ID de l'utilisateur connecté
   * @returns {Object} Objet contenant les dettes et le résumé pour l'utilisateur connecté
   */
  async calculateDebts(eventId, connectedUserId) {
    try {
      // 1. Récupérer toutes les dépenses de l'événement avec leurs participants
      const expenses = await this.getEventExpenses(eventId);
      
      // 2. Récupérer tous les participants de l'événement
      const participants = await this.getEventParticipants(eventId);
      
      // 3. Calculer les dettes entre participants
      const debts = this.computeDebts(expenses, participants);
      
      // 4. Calculer le résumé pour l'utilisateur connecté
      const userSummary = this.computeUserSummary(debts, connectedUserId, participants);
      
      const totalToPay = userSummary ? userSummary.total_to_pay : 0;
      const totalToReceive = userSummary ? userSummary.total_to_receive : 0;
      
      return {
        debts,
        user_summary: userSummary,
        total_to_pay: parseFloat(totalToPay.toFixed(2)),
        total_to_receive: parseFloat(totalToReceive.toFixed(2))
      };
    } catch (error) {
      console.error('Error calculating debts:', error);
      throw error;
    }
  }

  /**
   * Récupère toutes les dépenses d'un événement avec leurs participants
   * @param {number} eventId - ID de l'événement
   * @returns {Array} Liste des dépenses avec leurs participants
   */
  async getEventExpenses(eventId) {
    try {
      // Récupérer les dépenses
      const expensesQuery = `
        SELECT e.id, e.description, e.amount, e.paid_by, e.split_type, e.currency
        FROM expenses e
        WHERE e.event_id = ?
      `;
      const expenses = await db.query(expensesQuery, [eventId]);
      
      // Pour chaque dépense, récupérer les participants
      for (const expense of expenses) {
        const participantsQuery = `
          SELECT ep.participant_id, ep.share_amount, p.name, p.user_id
          FROM expense_participants ep
          JOIN participants p ON ep.participant_id = p.id
          WHERE ep.expense_id = ? AND ep.he_participates = TRUE
        `;
        expense.participants = await db.query(participantsQuery, [expense.id]);
      }
      
      return expenses;
    } catch (error) {
      console.error('Error fetching event expenses:', error);
      throw error;
    }
  }

  /**
   * Récupère tous les participants d'un événement
   * @param {number} eventId - ID de l'événement
   * @returns {Array} Liste des participants
   */
  async getEventParticipants(eventId) {
    try {
      const query = `
        SELECT p.id, p.name, p.user_id, u.username
        FROM participants p
        LEFT JOIN users u ON p.user_id = u.id
        WHERE p.event_id = ?
      `;
      return await db.query(query, [eventId]);
    } catch (error) {
      console.error('Error fetching event participants:', error);
      throw error;
    }
  }

  /**
   * Récupère tous les participants d'un événement à partir du code événement
   * @param {string} eventCode - Code de l'événement
   * @returns {Array} Liste des participants
   */
  async getEventParticipantsByCode(eventCode) {
    try {
      const eventQuery = `SELECT id FROM events WHERE code = ?`;
      const events = await db.query(eventQuery, [eventCode]);
      if (!events || events.length === 0) {
        throw new Error('Event not found');
      }
      const eventId = events[0].id;
      return await this.getEventParticipants(eventId);
    } catch (error) {
      console.error('Erreur lors de la récupération des participants par code:', error);
      throw error;
    }
  }

  /**
   * Calcule les dettes entre participants
   * @param {Array} expenses - Liste des dépenses
   * @param {Array} participants - Liste des participants
   * @returns {Array} Liste des dettes entre participants
   */
  computeDebts(expenses, participants) {
    // Créer un mapping des noms de participants vers leurs IDs
    const participantNameToId = {};
    participants.forEach(p => {
      participantNameToId[p.name] = p.id;
    });
    
    // Initialiser la matrice de dettes (qui doit combien à qui)
    const debtMatrix = {};
    participants.forEach(p1 => {
      debtMatrix[p1.name] = {};
      participants.forEach(p2 => {
        if (p1.name !== p2.name) {
          debtMatrix[p1.name][p2.name] = 0;
        }
      });
    });
    
    // Calculer les dettes pour chaque dépense
    expenses.forEach(expense => {
      const payer = expense.paid_by;
      
      // Pour chaque participant à la dépense
      expense.participants.forEach(participant => {
        if (participant.name !== payer) {
          // Le participant doit au payeur
          debtMatrix[participant.name][payer] += parseFloat(participant.share_amount);
        }
      });
    });
    
    // Calculer les dettes nettes (si A doit 4€ à B et B doit 3€ à A, alors A doit 1€ à B)
    const netDebts = [];
    participants.forEach(p1 => {
      participants.forEach(p2 => {
        if (p1.name !== p2.name) {
          const debt1 = debtMatrix[p1.name][p2.name] || 0;
          const debt2 = debtMatrix[p2.name][p1.name] || 0;
          
          if (debt1 > debt2) {
            // p2 doit plus à p1 que p1 à p2
            const netAmount = debt1 - debt2;
            if (netAmount > 0) {
              netDebts.push({
                from: p1.name,
                to: p2.name,
                amount: parseFloat(netAmount.toFixed(2))
              });
            }
          }
        }
      });
    });
    
    // Filtrer les dettes nulles
    return netDebts.filter(debt => debt.amount > 0);
  }

  /**
   * Calcule le résumé pour l'utilisateur connecté
   * @param {Array} debts - Liste des dettes
   * @param {number} connectedUserId - ID de l'utilisateur connecté
   * @param {Array} participants - Liste des participants
   * @returns {Object} Résumé pour l'utilisateur connecté
   */
  computeUserSummary(debts, connectedUserId, participants) {
    if (!connectedUserId) return null;
    
    const userParticipant = participants.find(p => p.user_id === parseInt(connectedUserId));
    if (!userParticipant) return null;
    
    const userName = userParticipant.name;
    
    let totalToPay = 0;
    let totalToReceive = 0;
    
    const credit = [];
    const debit = [];
    
    debts.forEach(debt => {
      const amount = parseFloat(debt.amount.toFixed(2));
      
      if (debt.from === userName) {
        totalToPay += amount;
        debit.push({
          to: debt.to,
          amount: amount
        });
      }
      
      if (debt.to === userName) {
        totalToReceive += amount;
        credit.push({
          from: debt.from,
          amount: amount
        });
      }
    });
    
    console.log('Total à recevoir:', totalToReceive);
    console.log('Total à payer:', totalToPay);
    
    return {
      user_id: parseInt(connectedUserId),
      total_to_pay: parseFloat(totalToPay.toFixed(2)),
      total_to_receive: parseFloat(totalToReceive.toFixed(2)),
      credit: credit.sort((a, b) => b.amount - a.amount),
      debit: debit.sort((a, b) => b.amount - a.amount)
    };
  }
}

// Exporter une instance de BalanceService au lieu de la classe
module.exports = new BalanceService();

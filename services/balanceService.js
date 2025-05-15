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
      console.log(`Calculating debts for event ${eventId} and user ${connectedUserId}`);
      
      // 1. Récupérer toutes les dépenses de l'événement avec leurs participants
      const expenses = await this.getEventExpenses(eventId);
      console.log(`Found ${expenses.length} expenses for event ${eventId}`);
      
      // 2. Récupérer tous les participants de l'événement
      const participants = await this.getEventParticipants(eventId);
      console.log(`Found ${participants.length} participants for event ${eventId}`);
      console.log('Participants:', participants.map(p => ({ id: p.id, name: p.name, user_id: p.user_id })));
      
      // 3. Calculer les dettes entre participants
      const debts = this.computeDebts(expenses, participants);
      console.log(`Computed ${debts.length} raw debts:`, JSON.stringify(debts));
      
      // 4. Optimiser les transferts pour minimiser le nombre de transactions
      const optimizedDebts = this.optimizeTransfers(debts, participants);
      console.log(`Optimized to ${optimizedDebts.length} debts:`, JSON.stringify(optimizedDebts));
      
      // 5. Calculer le résumé pour l'utilisateur connecté
      const userSummary = this.computeUserSummary(optimizedDebts, connectedUserId, participants);
      console.log(`User summary:`, JSON.stringify(userSummary));

      // Récupérer tous les remboursements de l'événement avec leur statut
      const reimbursements = await db.query(`
        SELECT r.*, pd.name as debtor_name, pc.name as creditor_name, r.status, r.id
        FROM reimbursements r
        JOIN participants pd ON r.debtor_id = pd.id
        JOIN participants pc ON r.creditor_id = pc.id
        WHERE r.event_id = ?
      `, [eventId]);

      // Créer un objet pour stocker les dettes initiales par paire de participants
      const debtMap = new Map();

      // Utiliser les dettes calculées par computeDebts pour initialiser debtMap
      // 'debts' ici est le résultat de this.computeDebts(expenses, participants)
      // qui contient des objets comme { from: 'NomDebiteur', to: 'NomCrediteur', amount: X }
      debts.forEach(debt => {
        const key = `${debt.from}-${debt.to}`;
        debtMap.set(key, (debtMap.get(key) || 0) + debt.amount);
      });

      // Créer un objet pour stocker les remboursements par paire de participants
      const reimbursementMap = new Map();
      const totalReimbursedMap = new Map(); // Nouveau map pour stocker le total des remboursements
      const reimbursementStatusMap = new Map(); // Map pour stocker les statuts des remboursements

      // Initialiser les maps de remboursement pour toutes les paires de participants possibles
      participants.forEach(p1 => {
        participants.forEach(p2 => {
          if (p1.name !== p2.name) {
            const key = `${p1.name}-${p2.name}`;
            // Initialiser reimbursementMap et totalReimbursedMap pour toutes les paires
            // afin d'éviter les undefined plus tard si une paire n'a pas de remboursement.
            if (!reimbursementMap.has(key)) {
              reimbursementMap.set(key, 0);
            }
            if (!totalReimbursedMap.has(key)) {
              totalReimbursedMap.set(key, 0);
            }
          }
        });
      });

      // Calculer les remboursements par paire de participants
      reimbursements.forEach(reimbursement => {
        const key = `${reimbursement.debtor_name}-${reimbursement.creditor_name}`;
        const reverseKey = `${reimbursement.creditor_name}-${reimbursement.debtor_name}`;
        
        // Ajouter au total des remboursements pour cette paire
        if (!totalReimbursedMap.has(key)) {
          totalReimbursedMap.set(key, 0);
        }
        totalReimbursedMap.set(key, totalReimbursedMap.get(key) + parseFloat(reimbursement.amount));
        
        // Ajouter au montant remboursé pour cette dette
        if (!reimbursementMap.has(key)) {
          reimbursementMap.set(key, 0);
        }
        
        // Ajouter le statut du remboursement à la map des statuts
        if (!reimbursementStatusMap.has(key)) {
          reimbursementStatusMap.set(key, []);
        }
        reimbursementStatusMap.get(key).push({
          id: reimbursement.id,
          amount: parseFloat(reimbursement.amount),
          status: reimbursement.status,
          date: reimbursement.date || reimbursement.timestamp
        });
        
        // N'ajouter au montant remboursé que si le statut est 'completed'
        if (reimbursement.status === 'completed') {
          reimbursementMap.set(key, reimbursementMap.get(key) + parseFloat(reimbursement.amount));
        }
      });

      // Calculer les dettes finales en soustrayant les remboursements
      const finalDebts = [];
      const userParticipant = participants.find(p => p.user_id === parseInt(connectedUserId));
      
      console.log(`Looking for user ${connectedUserId} in participants`);
      if (!userParticipant) {
        console.log(`User ${connectedUserId} not found in participants, returning empty debts`);
        // Si l'utilisateur n'est pas trouvé, essayons de le trouver par son username
        const userQuery = `SELECT username FROM users WHERE id = ?`;
        const userResults = await db.query(userQuery, [connectedUserId]);
        
        if (userResults && userResults.length > 0) {
          const username = userResults[0].username;
          console.log(`Found username ${username} for user ${connectedUserId}`);
          
          // Chercher un participant avec ce nom d'utilisateur
          const participantByName = participants.find(p => p.name === username);
          
          if (participantByName) {
            console.log(`Found participant by name ${username}, updating user_id`);
            // Mettre à jour le participant avec l'ID utilisateur
            await db.query('UPDATE participants SET user_id = ? WHERE id = ?', [connectedUserId, participantByName.id]);
            // Continuer avec ce participant
            participantByName.user_id = parseInt(connectedUserId);
            userParticipant = participantByName;
          } else {
            console.log(`No participant found with name ${username}`);
            return {
              debts: [],
              total_to_pay: 0,
              total_to_receive: 0
            };
          }
        } else {
          console.log(`No username found for user ${connectedUserId}`);
          return {
            debts: [],
            total_to_pay: 0,
            total_to_receive: 0
          };
        }
      }

      // Parcourir toutes les paires de participants possibles
      participants.forEach(debtor => {
        participants.forEach(creditor => {
          if (debtor.name !== creditor.name) {
            const key = `${debtor.name}-${creditor.name}`;
            const debtAmount = debtMap.get(key) || 0;
            const reimbursementAmount = reimbursementMap.get(key) || 0;
            const totalReimbursed = totalReimbursedMap.get(key) || 0;
            
            // Si la dette est supérieure aux remboursements
            if (debtAmount > reimbursementAmount) {
              const remainingAmount = debtAmount - reimbursementAmount;
              // Récupérer les statuts des remboursements pour cette paire
              const reimbursementStatuses = reimbursementStatusMap.get(key) || [];
              
              finalDebts.push({
                from: debtor.name,
                to: creditor.name,
                amount: remainingAmount,
                originalAmount: debtAmount,
                reimbursedAmount: reimbursementAmount,
                totalReimbursed: totalReimbursed,
                isFullyReimbursed: false,
                currency: expenses[0]?.currency || 'EUR',
                debtor_id: debtor.user_id, // Ajout de l'ID du débiteur
                creditor_id: creditor.user_id, // Ajout de l'ID du créditeur
                reimbursementStatuses: reimbursementStatuses // Ajout des statuts des remboursements
              });
            } else if (reimbursementAmount > 0) {
              // Si la dette a été complètement remboursée, on l'ajoute quand même pour l'affichage
              // Récupérer les statuts des remboursements pour cette paire
              const key = `${debtor.name}-${creditor.name}`;
              const reimbursementStatuses = reimbursementStatusMap.get(key) || [];
              
              finalDebts.push({
                from: debtor.name,
                to: creditor.name,
                amount: 0,
                originalAmount: debtAmount,
                reimbursedAmount: reimbursementAmount,
                totalReimbursed: totalReimbursed,
                isFullyReimbursed: true,
                currency: expenses[0]?.currency || 'EUR',
                debtor_id: debtor.user_id, // Ajout de l'ID du débiteur
                creditor_id: creditor.user_id, // Ajout de l'ID du créditeur
                reimbursementStatuses: reimbursementStatuses // Ajout des statuts des remboursements
              });
            }
          }
        });
      });

      // Calculer les totaux pour l'utilisateur connecté
      let total_to_pay = 0;
      let total_to_receive = 0;

      finalDebts.forEach(debt => {
        if (debt.from === userParticipant.name) {
          total_to_pay += debt.amount;
        }
        if (debt.to === userParticipant.name) {
          total_to_receive += debt.amount;
        }
      });

      console.log(`Returning ${finalDebts.length} debts, total_to_pay: ${total_to_pay}, total_to_receive: ${total_to_receive}`);
      
      // Si aucune dette n'est trouvée mais que des dettes optimisées existent, utiliser celles-ci
      if (finalDebts.length === 0 && optimizedDebts.length > 0) {
        console.log(`No final debts found but ${optimizedDebts.length} optimized debts exist, using those instead`);
        
        // Ajouter les statuts des remboursements aux dettes optimisées
        const optimizedDebtsWithStatus = optimizedDebts.map(debt => {
          const key = `${debt.from}-${debt.to}`;
          const reimbursementStatuses = reimbursementStatusMap.get(key) || [];
          return {
            ...debt,
            reimbursementStatuses
          };
        });
        
        return {
          debts: optimizedDebtsWithStatus,
          total_to_pay: userSummary ? userSummary.total_to_pay : 0,
          total_to_receive: userSummary ? userSummary.total_to_receive : 0
        };
      }
      
      return {
        debts: finalDebts,
        total_to_pay,
        total_to_receive
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
   * Optimise les transferts pour minimiser le nombre de transactions
   * @param {Array} debts - Liste des dettes nettes entre participants
   * @param {Array} participants - Liste des participants
   * @returns {Array} Liste optimisée des dettes
   */
  optimizeTransfers(debts, participants) {
    console.log('Optimizing transfers between specific participants only');
    
    // Créer une structure pour stocker les dettes entre chaque paire de participants
    const debtsByPair = new Map();
    
    // Regrouper les dettes par paire de participants
    debts.forEach(debt => {
      const key = `${debt.from}-${debt.to}`;
      if (!debtsByPair.has(key)) {
        debtsByPair.set(key, []);
      }
      debtsByPair.get(key).push(debt);
    });
    
    // Pour chaque paire, simplifier les dettes en une seule dette
    const simplifiedDebts = [];
    
    debtsByPair.forEach((pairDebts, key) => {
      const [from, to] = key.split('-');
      
      // Calculer le montant total des dettes pour cette paire
      const totalAmount = pairDebts.reduce((sum, debt) => sum + debt.amount, 0);
      
      // Récupérer les informations de remboursement si elles existent dans la première dette
      const firstDebt = pairDebts[0];
      const reimbursedAmount = firstDebt?.reimbursedAmount || 0;
      const totalReimbursed = firstDebt?.totalReimbursed || 0;
      const isFullyReimbursed = firstDebt?.isFullyReimbursed || false;
      
      // Si le montant est significatif ou s'il y a eu des remboursements, ajouter une dette simplifiée
      if (totalAmount > 0.01 || reimbursedAmount > 0) {
        // Calculer le montant restant après remboursements
        const remainingAmount = Math.max(0, totalAmount - reimbursedAmount);
        
        simplifiedDebts.push({
          from,
          to,
          amount: parseFloat(remainingAmount.toFixed(2)),
          currency: firstDebt?.currency || 'EUR',
          originalAmount: totalAmount,
          reimbursedAmount: reimbursedAmount,
          totalReimbursed: totalReimbursed,
          isFullyReimbursed: remainingAmount <= 0 && reimbursedAmount > 0
        });
      }
    });
    
    console.log(`Simplified ${debts.length} debts to ${simplifiedDebts.length} debts between specific participants`);
    return simplifiedDebts;
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
      // Utiliser le montant restant après remboursements (amount) au lieu du montant total
      const amount = parseFloat(debt.amount.toFixed(2));
      const originalAmount = debt.originalAmount ? parseFloat(debt.originalAmount.toFixed(2)) : amount;
      const reimbursedAmount = debt.reimbursedAmount ? parseFloat(debt.reimbursedAmount.toFixed(2)) : 0;
      
      if (debt.from === userName) {
        // Ajouter seulement le montant restant à payer
        totalToPay += amount;
        debit.push({
          to: debt.to,
          amount: amount,
          originalAmount: originalAmount,
          reimbursedAmount: reimbursedAmount,
          isFullyReimbursed: debt.isFullyReimbursed || false
        });
      }
      
      if (debt.to === userName) {
        // Ajouter seulement le montant restant à recevoir
        totalToReceive += amount;
        credit.push({
          from: debt.from,
          amount: amount,
          originalAmount: originalAmount,
          reimbursedAmount: reimbursedAmount,
          isFullyReimbursed: debt.isFullyReimbursed || false
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

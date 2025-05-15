const express = require('express');

module.exports = (db) => {
  const router = express.Router();

  /**
   * Route pour mettre à jour le statut d'un remboursement
   * Prend en paramètre l'ID du remboursement et le nouveau statut (completed ou rejected)
   */
  router.put('/api/reimbursements/:id/status', async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      
      // Valider les données d'entrée
      if (!id || !status || !['completed', 'rejected'].includes(status)) {
        return res.status(400).json({ 
          error: 'Données invalides. Le statut doit être "completed" ou "rejected".' 
        });
      }

      // Vérifier si le remboursement existe
      const checkQuery = 'SELECT * FROM reimbursements WHERE id = ?';
      const reimbursement = await db.query(checkQuery, [id]);
      
      if (!reimbursement || reimbursement.length === 0) {
        return res.status(404).json({ error: 'Remboursement non trouvé' });
      }

      // Mettre à jour le statut du remboursement
      const updateQuery = 'UPDATE reimbursements SET status = ? WHERE id = ?';
      await db.query(updateQuery, [status, id]);

      res.json({ 
        success: true, 
        message: `Statut du remboursement mis à jour avec succès: ${status}`,
        reimbursementId: id,
        status: status
      });
    } catch (error) {
      console.error('Erreur lors de la mise à jour du statut du remboursement:', error);
      res.status(500).json({ error: 'Erreur serveur lors de la mise à jour du statut' });
    }
  });

  /**
   * Route pour mettre à jour le statut d'un remboursement spécifique dans une dette
   * Cette route est utilisée par la fonction handleReimbursementAction dans l'interface
   */
  router.put('/api/events/:eventId/debt-reimbursement-status', async (req, res) => {
    try {
      const { eventId } = req.params;
      const { reimbursementId, amount, date, newStatus } = req.body;
      
      // Valider les données d'entrée
      if (!eventId || !reimbursementId || !amount || !date || !newStatus) {
        return res.status(400).json({ 
          error: 'Données invalides. Tous les champs sont requis.' 
        });
      }

      if (!['completed', 'rejected'].includes(newStatus)) {
        return res.status(400).json({ 
          error: 'Statut invalide. Le statut doit être "completed" ou "rejected".' 
        });
      }

      // Vérifier si le remboursement existe
      const checkQuery = 'SELECT * FROM reimbursements WHERE id = ? AND event_id = ?';
      const reimbursement = await db.query(checkQuery, [reimbursementId, eventId]);
      
      if (!reimbursement || reimbursement.length === 0) {
        return res.status(404).json({ error: 'Remboursement non trouvé' });
      }

      // Mettre à jour le statut du remboursement
      const updateQuery = 'UPDATE reimbursements SET status = ? WHERE id = ?';
      await db.query(updateQuery, [newStatus, reimbursementId]);

      res.json({ 
        success: true, 
        message: `Statut du remboursement mis à jour avec succès: ${newStatus}`,
        reimbursementId: reimbursementId,
        status: newStatus
      });
    } catch (error) {
      console.error('Erreur lors de la mise à jour du statut du remboursement:', error);
      res.status(500).json({ error: 'Erreur serveur lors de la mise à jour du statut' });
    }
  });

  return router;
};
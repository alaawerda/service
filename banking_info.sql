-- Create banking_info table to store user banking information
CREATE TABLE IF NOT EXISTS banking_info (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  type ENUM('rib', 'iban', 'paypal', 'wise', 'revolut', 'other') NOT NULL,
  account_details TEXT NOT NULL,
  other_name VARCHAR(255),
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT current_timestamp(),
  updated_at TIMESTAMP DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Add indexes for better query performance
CREATE INDEX idx_banking_info_user ON banking_info(user_id);

-- Create reimbursement_requests table to store reimbursement requests
CREATE TABLE IF NOT EXISTS reimbursement_requests (
  id INT PRIMARY KEY AUTO_INCREMENT,
  event_id INT NOT NULL,
  requester_id INT NOT NULL,
  debtor_id INT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  status ENUM('pending', 'approved', 'rejected', 'completed') DEFAULT 'pending',
  payment_method VARCHAR(255),
  payment_details TEXT,
  message TEXT,
  created_at TIMESTAMP DEFAULT current_timestamp(),
  updated_at TIMESTAMP DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (debtor_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Add indexes for reimbursement requests
CREATE INDEX idx_reimbursement_requests_event ON reimbursement_requests(event_id);
CREATE INDEX idx_reimbursement_requests_requester ON reimbursement_requests(requester_id);
CREATE INDEX idx_reimbursement_requests_debtor ON reimbursement_requests(debtor_id);
CREATE INDEX idx_reimbursement_requests_status ON reimbursement_requests(status);

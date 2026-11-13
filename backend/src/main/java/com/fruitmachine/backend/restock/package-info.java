/**
 * Restock workflow (issue #68, WF-03) on top of RESTOCK work orders: per-slot suggestions, planned lines, loading against a line of
 * an IN_PROGRESS work order (FIFO and expiry rules), reconciliation of planned vs loaded at completion.
 */
package com.fruitmachine.backend.restock;

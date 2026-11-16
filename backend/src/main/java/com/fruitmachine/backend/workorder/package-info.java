/**
 * Work orders (issue #66): one model for the jobs Staff do at a machine (RESTOCK, MAINTENANCE, INCIDENT) with lifecycle,
 * assignment, machine stop on start, alert links, notifications and an append-only history. Restock lines (4.4), schedules (4.5)
 * and customer reports (5.2) plug in through {@code WorkOrderService.createBySystem} and {@code WorkOrderCompletionCheck}.
 */
package com.fruitmachine.backend.workorder;

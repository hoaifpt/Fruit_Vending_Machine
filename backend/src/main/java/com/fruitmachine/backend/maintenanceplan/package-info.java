/**
 * Maintenance scheduling (issue #70, WF-04): recurring plans per machine; the system creates one MAINTENANCE work order (source
 * SCHEDULE) per due occurrence and moves the next due date when that work order is completed or cancelled.
 */
package com.fruitmachine.backend.maintenanceplan;

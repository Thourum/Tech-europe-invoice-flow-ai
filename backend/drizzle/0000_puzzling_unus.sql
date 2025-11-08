CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`s3_key` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invoice_line_items` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`description` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_price` real NOT NULL,
	`amount` real NOT NULL,
	`category` text,
	`sort_order` integer DEFAULT 0,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`email_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`vendor_name` text NOT NULL,
	`vendor_tax_id` text,
	`invoice_number` text NOT NULL,
	`invoice_date` text NOT NULL,
	`due_date` text,
	`currency` text DEFAULT 'USD' NOT NULL,
	`subtotal` real,
	`tax_amount` real,
	`total_amount` real NOT NULL,
	`assignment_department` text,
	`assignment_employee` text,
	`assignment_cost_center` text,
	`approver_notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);

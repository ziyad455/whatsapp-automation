# Product overview

## Problem

Many Moroccan small businesses conduct sales and customer service through WhatsApp. Staff repeatedly answer questions about prices, availability, services, hours, rules, and bookings; promising customers can be forgotten when a conversation stops; and a generic chatbot cannot safely represent information that differs by business and changes over time.

## Product

WhatsApp Automation is a multi-tenant SaaS that helps a business configure its own information and use one shared, business-aware AI system to serve WhatsApp customers. It combines:

- business-specific answers grounded in current authorized data;
- Darija, Arabic, French, English, and mixed-language conversations;
- persistent conversations and a staff inbox;
- explicit human takeover and return to AI;
- lead detection and a simple lead lifecycle;
- safe automatic follow-ups for inactive interested customers;
- later previous-customer reactivation and operational analytics;
- a dashboard for owners and staff to manage business information and customer work.

Initial architecture fixtures represent a car rental, salon, and gym. They are deliberately different so the design is tested against multiple business shapes. A real pilot should focus on one vertical even though the underlying platform remains generic.

## Business value

The system should reduce repetitive work, reply consistently outside staff attention, surface conversations that need a person, preserve sales opportunities, and show whether automation is helping. It should make business information maintainable by the business rather than requiring code or direct database edits.

## More than a chatbot

The product is an operational application around an AI capability. The AI does not own customer records, business facts, conversation control, lead state, scheduling, authorization, or message delivery. Those are deterministic application and database responsibilities.

The differentiator is therefore not a clever prompt. It is the combination of tenant isolation, configurable business schemas, current fact retrieval, auditable state, WhatsApp transport, human control, and business workflows.

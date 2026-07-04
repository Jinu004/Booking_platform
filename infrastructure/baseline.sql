--
-- PostgreSQL database dump
--

\restrict y9eiJu2Jy9RAsRNHNGDrQFJVwYiB2ik4NPMWDttrTFt0cJ62iRz82QGnuYMa30F

-- Dumped from database version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: auth_password_resets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_password_resets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid NOT NULL,
    token text NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    used boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: auth_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    ip_address text,
    user_agent text,
    token_hash text NOT NULL
);


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    customer_id uuid,
    conversation_id uuid,
    doctor_id uuid,
    source character varying(20) DEFAULT 'whatsapp'::character varying,
    status character varying(20) DEFAULT 'pending'::character varying,
    booking_date date NOT NULL,
    slot_time character varying(10),
    token_number integer,
    notes text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    patient_id uuid,
    patient_name character varying(255)
);


--
-- Name: catalogue_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalogue_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    product_id character varying(50) NOT NULL,
    name character varying(200) NOT NULL,
    description text DEFAULT ''::text,
    price numeric(10,2) DEFAULT 0 NOT NULL,
    in_stock boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: clinic_doctors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clinic_doctors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    specialization character varying(100),
    phone character varying(20),
    email character varying(255),
    qualification character varying(255),
    available_today boolean DEFAULT true,
    leave_days integer DEFAULT 0,
    max_tokens_daily integer DEFAULT 30,
    consultation_fee numeric(10,2),
    created_at timestamp without time zone DEFAULT now(),
    is_active boolean DEFAULT true,
    profile_description text
);


--
-- Name: clinic_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clinic_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    address text,
    city character varying(100),
    pincode character varying(10),
    opening_time time without time zone DEFAULT '09:00:00'::time without time zone NOT NULL,
    closing_time time without time zone DEFAULT '20:00:00'::time without time zone NOT NULL,
    lunch_start time without time zone,
    lunch_end time without time zone,
    weekly_off character varying(20) DEFAULT 'sunday'::character varying,
    registration_no character varying(100),
    gstin character varying(20),
    clinic_name character varying(255),
    working_hours text,
    phone character varying(20)
);


--
-- Name: clinic_services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clinic_services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    duration_minutes integer DEFAULT 10,
    fee numeric(10,2),
    is_active boolean DEFAULT true
);


--
-- Name: clinic_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clinic_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    booking_id uuid,
    doctor_id uuid,
    token_number integer NOT NULL,
    status character varying(20) DEFAULT 'waiting'::character varying,
    issued_at timestamp without time zone DEFAULT now(),
    consultation_start timestamp without time zone,
    consultation_end timestamp without time zone
);


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    customer_id uuid,
    channel character varying(20) DEFAULT 'whatsapp'::character varying NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying,
    assigned_to uuid,
    session_data jsonb,
    started_at timestamp without time zone DEFAULT now(),
    last_message_at timestamp without time zone DEFAULT now(),
    mode character varying(10) DEFAULT 'ai'::character varying NOT NULL,
    mode_changed_at timestamp without time zone,
    mode_changed_by uuid,
    needs_attention boolean DEFAULT false NOT NULL,
    contact_card_sent boolean DEFAULT false NOT NULL,
    CONSTRAINT conversations_mode_check CHECK (((mode)::text = ANY (ARRAY[('ai'::character varying)::text, ('human'::character varying)::text])))
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(255),
    phone character varying(20) NOT NULL,
    email character varying(255),
    date_of_birth date,
    notes text,
    last_seen timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: doctor_leaves; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.doctor_leaves (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    doctor_id uuid,
    leave_date date NOT NULL,
    reason character varying(255),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: doctor_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.doctor_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    doctor_id uuid NOT NULL,
    day_of_week integer NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    is_available boolean DEFAULT true
);


--
-- Name: leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    customer_phone character varying(20) NOT NULL,
    customer_name character varying(100) DEFAULT ''::character varying,
    product_id character varying(50) DEFAULT ''::character varying,
    product_name character varying(200) DEFAULT ''::character varying,
    quantity integer DEFAULT 1,
    delivery_address text DEFAULT ''::text,
    alt_phone character varying(20) DEFAULT ''::character varying,
    notes text DEFAULT ''::text,
    status character varying(20) DEFAULT 'new'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    order_number integer NOT NULL,
    order_total numeric(10,2) DEFAULT 0,
    payment_status character varying(20) DEFAULT 'unpaid'::character varying,
    payment_method character varying(20) DEFAULT ''::character varying,
    internal_notes text DEFAULT ''::text,
    tracking_id character varying(100) DEFAULT ''::character varying,
    unit_price numeric(10,2) DEFAULT 0,
    is_duplicate boolean DEFAULT false
);


--
-- Name: leads_order_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.leads_order_number_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: leads_order_number_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.leads_order_number_seq OWNED BY public.leads.order_number;


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    role character varying(20) NOT NULL,
    content text NOT NULL,
    type character varying(20) DEFAULT 'text'::character varying,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: migrations_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.migrations_log (
    id integer NOT NULL,
    filename character varying(255) NOT NULL,
    executed_at timestamp without time zone DEFAULT now()
);


--
-- Name: migrations_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.migrations_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: migrations_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.migrations_log_id_seq OWNED BY public.migrations_log.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    booking_id uuid,
    customer_id uuid,
    type character varying(50) NOT NULL,
    channel character varying(20) DEFAULT 'whatsapp'::character varying,
    status character varying(20) DEFAULT 'scheduled'::character varying,
    scheduled_at timestamp without time zone NOT NULL,
    sent_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: patient_conditions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patient_conditions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    customer_id uuid,
    patient_id uuid,
    type character varying(20) NOT NULL,
    name character varying(255) NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT patient_conditions_type_check CHECK (((type)::text = ANY (ARRAY[('condition'::character varying)::text, ('allergy'::character varying)::text, ('medication'::character varying)::text])))
);


--
-- Name: patient_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patient_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    age integer,
    gender character varying(10),
    blood_group character varying(5),
    emergency_contact_name character varying(255),
    emergency_contact_phone character varying(20),
    emergency_contact_relationship character varying(100),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: patients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    phone character varying(20) NOT NULL,
    age integer,
    gender character varying(10),
    blood_group character varying(5),
    emergency_contact_name character varying(255),
    emergency_contact_phone character varying(20),
    emergency_contact_relationship character varying(100),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: platform_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key character varying(100) NOT NULL,
    value text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    staff_id uuid NOT NULL,
    subscription text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: staff; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    role character varying(50) NOT NULL,
    email character varying(255),
    phone character varying(20),
    clerk_user_id character varying(255),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    password_hash character varying(255),
    temp_password character varying(255),
    email_verified boolean DEFAULT false,
    doctor_id uuid,
    temp_password_expires_at timestamp without time zone,
    last_login timestamp without time zone
);


--
-- Name: tenant_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    key character varying(100) NOT NULL,
    value text NOT NULL
);


--
-- Name: tenant_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    working_hours jsonb DEFAULT '{"friday": {"open": "09:00", "close": "18:00", "isOpen": true}, "monday": {"open": "09:00", "close": "18:00", "isOpen": true}, "sunday": {"open": "09:00", "close": "18:00", "isOpen": false}, "tuesday": {"open": "09:00", "close": "18:00", "isOpen": true}, "saturday": {"open": "09:00", "close": "18:00", "isOpen": true}, "thursday": {"open": "09:00", "close": "18:00", "isOpen": true}, "wednesday": {"open": "09:00", "close": "18:00", "isOpen": true}}'::jsonb,
    handoff_message text DEFAULT 'Let me connect you with a staff member.'::text,
    out_of_hours_message text DEFAULT 'We are currently closed.'::text,
    ai_knowledge_base text DEFAULT ''::text,
    language character varying(20) DEFAULT 'english'::character varying,
    business_address text DEFAULT ''::text,
    business_phone character varying(20) DEFAULT ''::character varying,
    business_email character varying(100) DEFAULT ''::character varying,
    payment_upi character varying(100) DEFAULT ''::character varying,
    payment_phone character varying(20) DEFAULT ''::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    slug character varying(100) NOT NULL,
    industry character varying(50) NOT NULL,
    plan character varying(20) DEFAULT 'starter'::character varying,
    status character varying(20) DEFAULT 'active'::character varying,
    whatsapp_number character varying(20),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    ai_model character varying(50) DEFAULT NULL::character varying
);


--
-- Name: visit_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visit_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    customer_id uuid,
    patient_id uuid,
    booking_id uuid,
    doctor_id uuid,
    visit_date date NOT NULL,
    diagnosis text,
    prescription text,
    follow_up_date date,
    notes text,
    created_by uuid,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: leads order_number; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads ALTER COLUMN order_number SET DEFAULT nextval('public.leads_order_number_seq'::regclass);


--
-- Name: migrations_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migrations_log ALTER COLUMN id SET DEFAULT nextval('public.migrations_log_id_seq'::regclass);


--
-- Name: auth_password_resets auth_password_resets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_password_resets
    ADD CONSTRAINT auth_password_resets_pkey PRIMARY KEY (id);


--
-- Name: auth_password_resets auth_password_resets_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_password_resets
    ADD CONSTRAINT auth_password_resets_token_key UNIQUE (token);


--
-- Name: auth_sessions auth_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: catalogue_items catalogue_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalogue_items
    ADD CONSTRAINT catalogue_items_pkey PRIMARY KEY (id);


--
-- Name: catalogue_items catalogue_items_tenant_id_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalogue_items
    ADD CONSTRAINT catalogue_items_tenant_id_product_id_key UNIQUE (tenant_id, product_id);


--
-- Name: clinic_doctors clinic_doctors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinic_doctors
    ADD CONSTRAINT clinic_doctors_pkey PRIMARY KEY (id);


--
-- Name: clinic_profiles clinic_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinic_profiles
    ADD CONSTRAINT clinic_profiles_pkey PRIMARY KEY (id);


--
-- Name: clinic_services clinic_services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinic_services
    ADD CONSTRAINT clinic_services_pkey PRIMARY KEY (id);


--
-- Name: clinic_tokens clinic_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinic_tokens
    ADD CONSTRAINT clinic_tokens_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: customers customers_tenant_id_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_tenant_id_phone_key UNIQUE (tenant_id, phone);


--
-- Name: doctor_leaves doctor_leaves_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_leaves
    ADD CONSTRAINT doctor_leaves_pkey PRIMARY KEY (id);


--
-- Name: doctor_schedules doctor_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_schedules
    ADD CONSTRAINT doctor_schedules_pkey PRIMARY KEY (id);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: migrations_log migrations_log_filename_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migrations_log
    ADD CONSTRAINT migrations_log_filename_key UNIQUE (filename);


--
-- Name: migrations_log migrations_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migrations_log
    ADD CONSTRAINT migrations_log_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: patient_conditions patient_conditions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_conditions
    ADD CONSTRAINT patient_conditions_pkey PRIMARY KEY (id);


--
-- Name: patient_profiles patient_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_profiles
    ADD CONSTRAINT patient_profiles_pkey PRIMARY KEY (id);


--
-- Name: patient_profiles patient_profiles_tenant_id_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_profiles
    ADD CONSTRAINT patient_profiles_tenant_id_customer_id_key UNIQUE (tenant_id, customer_id);


--
-- Name: patients patients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_pkey PRIMARY KEY (id);


--
-- Name: platform_config platform_config_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_config
    ADD CONSTRAINT platform_config_key_key UNIQUE (key);


--
-- Name: platform_config platform_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_config
    ADD CONSTRAINT platform_config_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_staff_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_staff_id_key UNIQUE (staff_id);


--
-- Name: staff staff_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_pkey PRIMARY KEY (id);


--
-- Name: tenant_configs tenant_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_configs
    ADD CONSTRAINT tenant_configs_pkey PRIMARY KEY (id);


--
-- Name: tenant_configs tenant_configs_tenant_id_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_configs
    ADD CONSTRAINT tenant_configs_tenant_id_key_key UNIQUE (tenant_id, key);


--
-- Name: tenant_settings tenant_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_settings
    ADD CONSTRAINT tenant_settings_pkey PRIMARY KEY (id);


--
-- Name: tenant_settings tenant_settings_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_settings
    ADD CONSTRAINT tenant_settings_tenant_id_key UNIQUE (tenant_id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_slug_key UNIQUE (slug);


--
-- Name: tenants tenants_whatsapp_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_whatsapp_number_key UNIQUE (whatsapp_number);


--
-- Name: visit_notes visit_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_notes
    ADD CONSTRAINT visit_notes_pkey PRIMARY KEY (id);


--
-- Name: idx_auth_sessions_staff_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_sessions_staff_id ON public.auth_sessions USING btree (staff_id);


--
-- Name: idx_auth_sessions_token_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_auth_sessions_token_hash ON public.auth_sessions USING btree (token_hash);


--
-- Name: idx_bookings_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_date ON public.bookings USING btree (tenant_id, booking_date);


--
-- Name: idx_bookings_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_tenant ON public.bookings USING btree (tenant_id);


--
-- Name: idx_catalogue_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catalogue_tenant ON public.catalogue_items USING btree (tenant_id);


--
-- Name: idx_clinic_doctors_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clinic_doctors_tenant ON public.clinic_doctors USING btree (tenant_id);


--
-- Name: idx_conversations_mode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_mode ON public.conversations USING btree (tenant_id, mode);


--
-- Name: idx_conversations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_status ON public.conversations USING btree (tenant_id, status);


--
-- Name: idx_conversations_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_tenant ON public.conversations USING btree (tenant_id);


--
-- Name: idx_customers_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_phone ON public.customers USING btree (tenant_id, phone);


--
-- Name: idx_customers_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_tenant ON public.customers USING btree (tenant_id);


--
-- Name: idx_leads_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_tenant ON public.leads USING btree (tenant_id);


--
-- Name: idx_messages_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conv ON public.messages USING btree (conversation_id);


--
-- Name: idx_notifications_sched; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_sched ON public.notifications USING btree (status, scheduled_at);


--
-- Name: idx_notifications_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_tenant ON public.notifications USING btree (tenant_id);


--
-- Name: idx_patients_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patients_customer ON public.patients USING btree (tenant_id, customer_id);


--
-- Name: idx_patients_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patients_tenant ON public.patients USING btree (tenant_id);


--
-- Name: idx_patients_tenant_customer_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_patients_tenant_customer_name ON public.patients USING btree (tenant_id, customer_id, lower((name)::text));


--
-- Name: push_subscriptions_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_subscriptions_tenant_id_idx ON public.push_subscriptions USING btree (tenant_id);


--
-- Name: auth_password_resets auth_password_resets_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_password_resets
    ADD CONSTRAINT auth_password_resets_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;


--
-- Name: auth_sessions auth_sessions_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;


--
-- Name: auth_sessions auth_sessions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);


--
-- Name: bookings bookings_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: bookings bookings_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.clinic_doctors(id);


--
-- Name: bookings bookings_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE SET NULL;


--
-- Name: bookings bookings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: catalogue_items catalogue_items_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalogue_items
    ADD CONSTRAINT catalogue_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: clinic_doctors clinic_doctors_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinic_doctors
    ADD CONSTRAINT clinic_doctors_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: clinic_profiles clinic_profiles_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinic_profiles
    ADD CONSTRAINT clinic_profiles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: clinic_services clinic_services_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinic_services
    ADD CONSTRAINT clinic_services_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: clinic_tokens clinic_tokens_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinic_tokens
    ADD CONSTRAINT clinic_tokens_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);


--
-- Name: clinic_tokens clinic_tokens_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinic_tokens
    ADD CONSTRAINT clinic_tokens_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.clinic_doctors(id);


--
-- Name: clinic_tokens clinic_tokens_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinic_tokens
    ADD CONSTRAINT clinic_tokens_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.staff(id);


--
-- Name: conversations conversations_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: conversations conversations_mode_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_mode_changed_by_fkey FOREIGN KEY (mode_changed_by) REFERENCES public.staff(id) ON DELETE SET NULL;


--
-- Name: conversations conversations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: customers customers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: doctor_leaves doctor_leaves_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_leaves
    ADD CONSTRAINT doctor_leaves_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.clinic_doctors(id);


--
-- Name: doctor_leaves doctor_leaves_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_leaves
    ADD CONSTRAINT doctor_leaves_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: doctor_schedules doctor_schedules_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_schedules
    ADD CONSTRAINT doctor_schedules_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.clinic_doctors(id);


--
-- Name: doctor_schedules doctor_schedules_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_schedules
    ADD CONSTRAINT doctor_schedules_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: leads leads_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);


--
-- Name: notifications notifications_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: notifications notifications_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: patient_conditions patient_conditions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_conditions
    ADD CONSTRAINT patient_conditions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: patient_conditions patient_conditions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_conditions
    ADD CONSTRAINT patient_conditions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: patient_profiles patient_profiles_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_profiles
    ADD CONSTRAINT patient_profiles_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: patient_profiles patient_profiles_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_profiles
    ADD CONSTRAINT patient_profiles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: patients patients_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: patients patients_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: staff staff_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_configs tenant_configs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_configs
    ADD CONSTRAINT tenant_configs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_settings tenant_settings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_settings
    ADD CONSTRAINT tenant_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: visit_notes visit_notes_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_notes
    ADD CONSTRAINT visit_notes_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: visit_notes visit_notes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_notes
    ADD CONSTRAINT visit_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.staff(id) ON DELETE SET NULL;


--
-- Name: visit_notes visit_notes_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_notes
    ADD CONSTRAINT visit_notes_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: visit_notes visit_notes_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_notes
    ADD CONSTRAINT visit_notes_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.clinic_doctors(id) ON DELETE SET NULL;


--
-- Name: visit_notes visit_notes_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_notes
    ADD CONSTRAINT visit_notes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict y9eiJu2Jy9RAsRNHNGDrQFJVwYiB2ik4NPMWDttrTFt0cJ62iRz82QGnuYMa30F


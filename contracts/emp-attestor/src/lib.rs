#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, BytesN, Env,
    Symbol,
};

/// Storage keys.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Attestation record, keyed by attestation id.
    Att(BytesN<32>),
    /// Consent flag, keyed by (subject, profile_type).
    Consent(Address, Symbol),
    /// The account allowed to issue attestations (the EMP backend).
    Issuer,
}

#[contracttype]
#[derive(Clone)]
pub struct Attestation {
    pub issuer: Address,
    pub subject: Address,
    pub profile_type: Symbol, // "loan" | "hiring" | "freelancer" | "insurance"
    pub hash: BytesN<32>,     // SHA-256 of the signed profile JSON
    pub issued_ledger: u32,
    pub revoked: bool,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInit = 1,
    NotInit = 2,
    NoConsent = 3,
    NotFound = 4,
    AlreadyExists = 5,
    NotAuthorized = 6,
}

#[contract]
pub struct EmpAttestor;

#[contractimpl]
impl EmpAttestor {
    /// One-time setup: fix the issuer account (EMP backend key).
    pub fn init(env: Env, issuer: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Issuer) {
            return Err(Error::AlreadyInit);
        }
        env.storage().instance().set(&DataKey::Issuer, &issuer);
        Ok(())
    }

    /// Subject records consent for a profile type. Only the subject can call.
    pub fn grant_consent(env: Env, subject: Address, profile_type: Symbol) {
        subject.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::Consent(subject, profile_type), &true);
    }

    /// Subject revokes consent for a profile type.
    pub fn revoke_consent(env: Env, subject: Address, profile_type: Symbol) {
        subject.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::Consent(subject, profile_type), &false);
    }

    pub fn has_consent(env: Env, subject: Address, profile_type: Symbol) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Consent(subject, profile_type))
            .unwrap_or(false)
    }

    /// Issuer anchors a signed profile. Requires issuer auth + subject consent.
    pub fn attest(
        env: Env,
        id: BytesN<32>,
        subject: Address,
        profile_type: Symbol,
        hash: BytesN<32>,
    ) -> Result<(), Error> {
        let issuer: Address = env
            .storage()
            .instance()
            .get(&DataKey::Issuer)
            .ok_or(Error::NotInit)?;
        issuer.require_auth();

        if env.storage().persistent().has(&DataKey::Att(id.clone())) {
            return Err(Error::AlreadyExists);
        }
        let consented: bool = env
            .storage()
            .persistent()
            .get(&DataKey::Consent(subject.clone(), profile_type.clone()))
            .unwrap_or(false);
        if !consented {
            return Err(Error::NoConsent);
        }

        let att = Attestation {
            issuer,
            subject,
            profile_type,
            hash,
            issued_ledger: env.ledger().sequence(),
            revoked: false,
        };
        env.storage().persistent().set(&DataKey::Att(id), &att);
        Ok(())
    }

    /// Verify an attestation exists, matches the given hash, and is not revoked.
    pub fn verify(env: Env, id: BytesN<32>, hash: BytesN<32>) -> bool {
        match env
            .storage()
            .persistent()
            .get::<_, Attestation>(&DataKey::Att(id))
        {
            Some(a) => !a.revoked && a.hash == hash,
            None => false,
        }
    }

    /// Revoke an attestation. Callable by the subject or the issuer.
    pub fn revoke(env: Env, id: BytesN<32>, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        let mut att: Attestation = env
            .storage()
            .persistent()
            .get(&DataKey::Att(id.clone()))
            .ok_or(Error::NotFound)?;
        if caller != att.subject && caller != att.issuer {
            return Err(Error::NotAuthorized);
        }
        att.revoked = true;
        env.storage().persistent().set(&DataKey::Att(id), &att);
        Ok(())
    }

    pub fn get(env: Env, id: BytesN<32>) -> Result<Attestation, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Att(id))
            .ok_or(Error::NotFound)
    }
}

const _: Symbol = symbol_short!("loan"); // compile-time sanity that profile symbols fit

mod test;

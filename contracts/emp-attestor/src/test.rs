#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, symbol_short, Address, BytesN, Env};

fn setup() -> (Env, EmpAttestorClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(EmpAttestor, ());
    let client = EmpAttestorClient::new(&env, &contract_id);
    let issuer = Address::generate(&env);
    let subject = Address::generate(&env);
    client.init(&issuer);
    (env, client, issuer, subject)
}

fn id32(env: &Env, b: u8) -> BytesN<32> {
    BytesN::from_array(env, &[b; 32])
}

#[test]
fn attest_requires_consent_then_succeeds() {
    let (env, client, _issuer, subject) = setup();
    let ptype = symbol_short!("loan");
    let id = id32(&env, 1);
    let hash = id32(&env, 9);

    // no consent yet
    assert_eq!(client.has_consent(&subject, &ptype), false);

    // grant, then attest
    client.grant_consent(&subject, &ptype);
    assert_eq!(client.has_consent(&subject, &ptype), true);
    client.attest(&id, &subject, &ptype, &hash);

    // verify matches hash, not revoked
    assert_eq!(client.verify(&id, &hash), true);
    assert_eq!(client.verify(&id, &id32(&env, 0)), false); // wrong hash
}

#[test]
#[should_panic] // NoConsent error
fn attest_without_consent_fails() {
    let (env, client, _issuer, subject) = setup();
    let id = id32(&env, 2);
    client.attest(&id, &subject, &symbol_short!("hiring"), &id32(&env, 9));
}

#[test]
fn revoke_marks_invalid() {
    let (env, client, issuer, subject) = setup();
    let ptype = symbol_short!("loan");
    let id = id32(&env, 3);
    let hash = id32(&env, 9);
    client.grant_consent(&subject, &ptype);
    client.attest(&id, &subject, &ptype, &hash);
    assert_eq!(client.verify(&id, &hash), true);

    client.revoke(&id, &issuer);
    assert_eq!(client.verify(&id, &hash), false);
    assert_eq!(client.get(&id).revoked, true);
}

#[test]
#[should_panic] // AlreadyExists
fn duplicate_attest_fails() {
    let (env, client, _issuer, subject) = setup();
    let ptype = symbol_short!("loan");
    let id = id32(&env, 4);
    client.grant_consent(&subject, &ptype);
    client.attest(&id, &subject, &ptype, &id32(&env, 9));
    client.attest(&id, &subject, &ptype, &id32(&env, 9)); // dup
}

#[test]
fn revoke_consent_blocks_new_attest() {
    let (_env, client, _issuer, subject) = setup();
    let ptype = symbol_short!("loan");
    client.grant_consent(&subject, &ptype);
    client.revoke_consent(&subject, &ptype);
    assert_eq!(client.has_consent(&subject, &ptype), false);
}

(define (domain deliveroo-tour)
  (:requirements :strips :typing :action-costs)

  (:types location parcel - object)

  (:predicates
    (at ?l - location)
    (reachable ?from ?to - location)
    (delivery ?l - location)
    (parcel-at ?p - parcel ?l - location)
    (carrying ?p - parcel)
    (delivered ?p - parcel))

  (:functions
    (dist ?from ?to - location) - number
    (total-cost) - number)

  (:action move
    :parameters (?from ?to - location)
    :precondition (and (at ?from) (reachable ?from ?to))
    :effect (and (not (at ?from)) (at ?to)
                 (increase (total-cost) (dist ?from ?to))))

  (:action pickup
    :parameters (?p - parcel ?l - location)
    :precondition (and (at ?l) (parcel-at ?p ?l))
    :effect (and (not (parcel-at ?p ?l)) (carrying ?p)))

  (:action deliver
    :parameters (?p - parcel ?l - location)
    :precondition (and (at ?l) (carrying ?p) (delivery ?l))
    :effect (and (not (carrying ?p)) (delivered ?p))))

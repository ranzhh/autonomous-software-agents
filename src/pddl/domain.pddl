(define (domain deliveroo)
  (:requirements :strips :typing)
  (:types location parcel)
  (:predicates
    (at ?l - location)
    (parcel-at ?p - parcel ?l - location)
    (carrying ?p - parcel)
    (delivered ?p - parcel)
    (delivery ?l - location)
    (connected ?a - location ?b - location))

  (:action move
    :parameters (?from - location ?to - location)
    :precondition (and (at ?from) (connected ?from ?to))
    :effect (and (not (at ?from)) (at ?to)))

  (:action pickup
    :parameters (?p - parcel ?l - location)
    :precondition (and (at ?l) (parcel-at ?p ?l))
    :effect (and (carrying ?p) (not (parcel-at ?p ?l))))

  (:action deliver
    :parameters (?p - parcel ?l - location)
    :precondition (and (at ?l) (delivery ?l) (carrying ?p))
    :effect (and (delivered ?p) (not (carrying ?p)))))

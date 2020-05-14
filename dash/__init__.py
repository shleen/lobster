"""
Dashboard package initializer.
Christina Fosheim-Hoag <cmfh@umich.edu> and Noa Levi <nlevi@umich.edu>
"""
import flask

# app is a single object used by all the code modules in this package
app = flask.Flask(__name__)  # pylint: disable=invalid-name


# Tell our app about views.  This is dangerously close to a
# circular import, which is naughty, but Flask was designed that way.
# (Reference http://flask.pocoo.org/docs/0.12/patterns/packages/)  We're
# going to tell pylint and pycodestyle to ignore this coding style violation.
import insta485.views  # noqa: E402  pylint: disable=wrong-import-position